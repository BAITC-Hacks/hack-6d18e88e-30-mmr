"""Regression boundary between hardened AI routes and cookie account routes."""
from fastapi.testclient import TestClient

from backend.config import Settings as AccountSettings
from backend.main import create_app
from settings import Settings as ApiSettings

TOKEN = "local-test-token-with-at-least-32-characters"
ORIGIN = "http://localhost:8000"


def app_for(tmp_path, **overrides):
    accounts = AccountSettings(database_path=tmp_path / "accounts.sqlite3", mail_directory=tmp_path / "mail", mail_worker_enabled=False)
    return create_app(ApiSettings(api_access_token=TOKEN, **overrides), account_settings=accounts)


def test_account_session_boundary_does_not_remove_ai_bearer(tmp_path):
    with TestClient(app_for(tmp_path), base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        response = client.post("/api/auth/register", json={"email": "integration@example.com", "password": "A strong password 123!", "full_name": "Integration"})
        assert response.status_code == 202
        assert client.get("/api/auth/me").json()["detail"] == "Войдите в аккаунт."
        assert client.get("/api/mail/campaigns/1").json()["detail"] == "Войдите в аккаунт."
        client.cookies.set("ai_sana_session", "not-a-bearer-token")
        assert client.get("/api/ai/inspector").json()["detail"]["code"] == "UNAUTHORIZED"
        assert client.get("/api/ai/inspector", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200
        for path in ("/api/unknown", "/api/auth/unknown", "/api/auth/me/", "/api/auth/me/extra", "/api/mail/campaigns/1/extra"):
            assert client.get(path).json()["detail"]["code"] == "UNAUTHORIZED"


def test_only_registered_account_methods_skip_bearer_under_root_path(tmp_path):
    with TestClient(app_for(tmp_path), base_url=ORIGIN, root_path="/gateway") as client:
        response = client.get("/gateway/api/auth/me")
        assert response.status_code == 401
        assert response.json()["detail"] == "Войдите в аккаунт."
        for path in ("/gateway/api/auth/me/", "/gateway/api/auth/register", "/gateway/api/ai/inspector"):
            assert client.get(path).json()["detail"]["code"] == "UNAUTHORIZED"


def test_auth_patch_and_post_keep_strict_json_and_safe_errors(tmp_path):
    with TestClient(app_for(tmp_path), base_url=ORIGIN) as client:
        headers = {"Content-Type": "application/json", "Origin": ORIGIN}
        invalid = client.post("/api/auth/register", content='{"email":"private-value","email":"other-value"}', headers=headers)
        assert invalid.status_code == 400
        assert invalid.json()["detail"]["code"] == "INVALID_JSON"
        assert "private-value" not in invalid.text
        invalid_patch = client.patch("/api/auth/preferences", content='{"newsletter_opt_in":true,"newsletter_opt_in":false}', headers=headers)
        assert invalid_patch.status_code == 400
        assert invalid_patch.json()["detail"]["code"] == "INVALID_JSON"
        large = client.patch("/api/auth/preferences", content='{"text":"' + "x" * 262144 + '"}', headers=headers)
        assert large.status_code == 413
        assert client.post("/api/auth/logout").status_code == 200
        assert client.post("/api/auth/logout", content='not-json', headers=headers).status_code == 400


def test_cookie_csrf_and_account_cors_are_separate_from_ai_cors(tmp_path):
    with TestClient(app_for(tmp_path), base_url=ORIGIN) as client:
        client.cookies.set("ai_sana_session", "unknown-session")
        assert client.post("/api/auth/logout").status_code == 403
        assert client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.post("/api/auth/logout", headers={"Origin": ORIGIN}).status_code == 200
        headers = {"Origin": ORIGIN, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type"}
        accounts = client.options("/api/auth/preferences", headers=headers)
        assert accounts.status_code == 200
        assert accounts.headers["access-control-allow-credentials"] == "true"
        core = client.options("/api/ai/analyze", headers={**headers, "Access-Control-Request-Method": "POST"})
        assert core.status_code == 200
        assert "access-control-allow-credentials" not in core.headers
        assert client.options("/api/ai/analyze", headers=headers).status_code == 400


def test_account_routes_retain_outer_budget_and_credentialed_errors(tmp_path):
    with TestClient(app_for(tmp_path, rate_limit_per_client=2), base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        assert client.post("/api/auth/register", json={}).status_code == 422
        assert client.post("/api/auth/register", json={}).status_code == 422
        blocked = client.post("/api/auth/register", json={})
        assert blocked.status_code == 429
        assert blocked.headers["access-control-allow-credentials"] == "true"
        assert blocked.headers["access-control-allow-origin"] == ORIGIN
