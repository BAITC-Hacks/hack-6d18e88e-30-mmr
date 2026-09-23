"""Local unit/integration security checks; no load or external provider traffic."""

from dataclasses import replace
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from main import create_app
from security import RateLimiter
from settings import Settings


TOKEN = "local-test-token-with-at-least-32-characters"


def production_settings(**overrides):
    return Settings(
        environment="production", api_access_token=TOKEN,
        allowed_hosts=("api.example.test",), allowed_origins=("https://app.example.test",),
        **overrides,
    )


def probe_app(settings=None):
    application = create_app(settings or Settings())

    @application.post("/api/probe")
    async def probe():
        return {"ok": True}

    return application


@pytest.mark.parametrize("overrides", [
    {}, {"api_access_token": TOKEN},
    {"api_access_token": TOKEN, "allowed_hosts": ("api.example.test",)},
    {"api_access_token": "short", "allowed_hosts": ("api.example.test",), "allowed_origins": ("https://app.example.test",)},
])
def test_production_fails_closed_without_explicit_secure_configuration(overrides):
    with pytest.raises(ValueError):
        Settings(environment="production", **overrides)


@pytest.mark.parametrize("host", ["*", "*.example.test", "http://example.test", "example.test/path", "example.test:80", "good.test@bad.test", "bad host"])
def test_hosts_cannot_use_wildcards_urls_or_ambiguous_authorities(host):
    with pytest.raises(ValueError):
        replace(production_settings(), allowed_hosts=(host,))


@pytest.mark.parametrize("origin", ["*", "null", "http://app.example.test", "https://user:pass@app.example.test", "https://app.example.test/path", "https://app.example.test?key=secret", "https://app.example.test#fragment"])
def test_production_origins_must_be_exact_https_origins(origin):
    with pytest.raises(ValueError):
        replace(production_settings(), allowed_origins=(origin,))


@pytest.mark.parametrize("token", ["short", "a" * 257, "x" * 32 + "\n", "пароль" * 10])
def test_access_token_rejects_weak_control_character_or_non_ascii_values(token):
    with pytest.raises(ValueError):
        Settings(api_access_token=token)


def test_settings_read_environment_without_leaking_token_in_repr(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("API_ACCESS_TOKEN", TOKEN)
    monkeypatch.setenv("API_ALLOWED_HOSTS", "api.example.test")
    monkeypatch.setenv("API_ALLOWED_ORIGINS", "https://app.example.test")
    monkeypatch.setenv("API_RATE_LIMIT_PER_CLIENT", "3")
    settings = Settings.from_env()
    assert settings.environment == "production"
    assert settings.rate_limit_per_client == 3
    assert TOKEN not in repr(settings)


def test_invalid_numeric_configuration_does_not_echo_its_value(monkeypatch):
    monkeypatch.setenv("API_RATE_LIMIT_GLOBAL", "accidentally-pasted-secret")
    with pytest.raises(ValueError) as error:
        Settings.from_env()
    assert str(error.value) == "API_RATE_LIMIT_GLOBAL must be a valid integer"


@pytest.mark.parametrize("path,method", [
    ("/api/ai/analyze", "post"), ("/api/ai/generate-card", "post"),
    ("/api/ai/inspector", "get"), ("/api/unknown", "get"),
])
def test_every_api_route_requires_bearer_token_when_configured(path, method):
    with TestClient(create_app(Settings(api_access_token=TOKEN))) as client:
        response = getattr(client, method)(path)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert TOKEN not in response.text


@pytest.mark.parametrize("authorization", [None, "Bearer wrong", "Basic " + TOKEN, "Bearer", "Bearer " + TOKEN + " extra"])
def test_malformed_or_wrong_authorization_fails_before_body_parsing(authorization):
    headers = {"authorization": authorization} if authorization else {}
    with TestClient(probe_app(Settings(api_access_token=TOKEN))) as client:
        response = client.post("/api/probe", content="invalid-json", headers=headers)
    assert response.status_code == 401


def test_duplicate_authorization_is_rejected_and_valid_token_works():
    with TestClient(probe_app(Settings(api_access_token=TOKEN))) as client:
        response = client.post("/api/probe", json={}, headers=[
            ("authorization", "Bearer " + TOKEN), ("authorization", "Bearer wrong"),
        ])
        assert response.status_code == 401
        assert client.post("/api/probe", json={}, headers={"authorization": "Bearer " + TOKEN}).status_code == 200
        assert client.get("/api/ai/inspector", headers={"authorization": "Bearer " + TOKEN}).status_code == 200


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"])
def test_docs_are_protected_in_development_and_disabled_in_production(path):
    with TestClient(create_app(Settings(api_access_token=TOKEN))) as client:
        assert client.get(path).status_code == 401
    with TestClient(create_app(production_settings()), base_url="https://api.example.test") as client:
        assert client.get(path, headers={"authorization": "Bearer " + TOKEN}).status_code == 404


def test_development_rejects_remote_clients_even_with_local_host_and_forwarded_headers():
    with TestClient(create_app(Settings()), client=("198.51.100.8", 50000)) as client:
        response = client.get("/health", headers={"x-forwarded-for": "127.0.0.1"})
        assert response.status_code == 403


@pytest.mark.parametrize("address", ["127.0.0.1", "::1", "testclient"])
def test_development_allows_local_clients(address):
    with TestClient(create_app(Settings()), client=(address, 50000)) as client:
        assert client.get("/health").status_code == 200


def test_host_and_origin_checks_prevent_untrusted_browser_access():
    with TestClient(probe_app()) as client:
        assert client.get("/health", headers={"host": "attacker.example"}).status_code == 400
        assert client.get("/health", headers=[("host", "testserver"), ("host", "attacker.example")]).status_code == 400
        assert client.post("/api/probe", json={}, headers={"origin": "https://attacker.example"}).status_code == 403
    with TestClient(create_app(Settings()), base_url="http://[::1]:8000") as client:
        assert client.get("/health").status_code == 200


def test_cors_only_allows_configured_origin_methods_and_headers_without_credentials():
    headers = {"origin": "http://localhost:5173", "access-control-request-method": "POST", "access-control-request-headers": "content-type,authorization"}
    with TestClient(probe_app(Settings(api_access_token=TOKEN))) as client:
        preflight = client.options("/api/probe", headers=headers)
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == headers["origin"]
        assert "access-control-allow-credentials" not in preflight.headers
        assert set(preflight.headers["access-control-allow-methods"].split(", ")) == {"GET", "POST", "OPTIONS"}
        assert client.options("/api/probe", headers={**headers, "access-control-request-method": "DELETE"}).status_code == 400
        assert client.options("/api/probe", headers={**headers, "access-control-request-headers": "x-custom-admin"}).status_code == 400
        assert client.options("/api/probe").status_code == 401
        denied = client.post("/api/probe", json={}, headers={"origin": headers["origin"]})
        assert denied.status_code == 401
        assert denied.headers["access-control-allow-origin"] == headers["origin"]
        assert "access-control-allow-credentials" not in denied.headers


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
def test_default_development_origin_supports_swagger_try_it_out(host):
    origin = f"http://{host}:8000"
    with TestClient(probe_app(), base_url=origin) as client:
        assert client.get("/docs").status_code == 200
        response = client.post("/api/probe", json={}, headers={"origin": origin})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
def test_default_development_origin_supports_vite_preview_proxy(host):
    origin = f"http://{host}:4173"
    with TestClient(probe_app()) as client:
        response = client.post("/api/probe", json={}, headers={"origin": origin})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin


def test_limiter_per_client_global_caps_expiry_and_bounded_memory():
    now = [100.0]
    limiter = RateLimiter(per_client=2, global_limit=3, window_seconds=10, max_clients=2, clock=lambda: now[0])
    assert limiter.check("a") == 0
    assert limiter.check("a") == 0
    assert limiter.check("a") == 10
    assert limiter.check("b") == 0
    assert limiter.check("c") == 10
    now[0] += 10
    assert limiter.check("c") == 0
    assert limiter.client_count == 1
    limiter.reset()
    assert limiter.client_count == 0
    assert limiter.check("a") == 0
    assert limiter.check("b") == 0
    assert limiter.check("c") == 10, "new clients must not evict existing rate-limit records"
    assert limiter.client_count == 2


def test_rate_limit_ignores_spoofed_forwarded_headers_and_returns_retry_after():
    settings = Settings(rate_limit_per_client=2, rate_limit_global=5)
    application = probe_app(settings)
    with TestClient(application) as client:
        assert client.post("/api/probe", json={}, headers={"x-forwarded-for": "203.0.113.1"}).status_code == 200
        assert client.post("/api/probe", json={}, headers={"x-forwarded-for": "203.0.113.2"}).status_code == 200
        blocked = client.post("/api/probe", json={}, headers={"x-forwarded-for": "203.0.113.3"})
        assert blocked.status_code == 429
        assert 1 <= int(blocked.headers["retry-after"]) <= settings.rate_limit_window_seconds
        assert client.get("/health").status_code == 200
        assert client.get("/api/ai/inspector").status_code == 200


def test_global_rate_limit_caps_distinct_authenticated_clients():
    application = probe_app(production_settings(rate_limit_per_client=2, rate_limit_global=2))
    for index in range(3):
        with TestClient(application, base_url="https://api.example.test", client=(f"198.51.100.{index + 1}", 50000)) as client:
            response = client.post("/api/probe", json={}, headers={"authorization": "Bearer " + TOKEN})
            assert response.status_code == (200 if index < 2 else 429)


@pytest.mark.parametrize("path,method", [("/api/ai/inspector", "get"), ("/api/probe", "post"), ("/docs", "get")])
def test_gateway_root_path_cannot_bypass_api_or_docs_authentication(path, method):
    with TestClient(probe_app(Settings(api_access_token=TOKEN)), root_path="/gateway") as client:
        response = getattr(client, method)("/gateway" + path)
        assert response.status_code == 401
        options = {"headers": {"authorization": "Bearer " + TOKEN}}
        if method == "post":
            options["json"] = {}
        assert getattr(client, method)("/gateway" + path, **options).status_code == 200


def test_gateway_root_path_cannot_bypass_rate_budget():
    with TestClient(probe_app(Settings(rate_limit_per_client=1)), root_path="/gateway") as client:
        assert client.post("/gateway/api/probe", json={}).status_code == 200
        assert client.post("/gateway/api/probe", json={}).status_code == 429


@pytest.mark.parametrize("path,status", [("/health", 200), ("/api/ai/inspector", 401), ("/missing", 404)])
def test_success_and_error_responses_have_defensive_headers(path, status):
    with TestClient(create_app(Settings(api_access_token=TOKEN))) as client:
        response = client.get(path)
    assert response.status_code == status
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
