from contextlib import contextmanager
from dataclasses import replace
from unittest.mock import Mock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.services.mail import process_outbox
from backend.services.security import digest
from backend.services.supabase_gateway import api_call

USER_ID = "7dce8bc8-0d28-41c7-9058-f8cce289bfc8"
ORIGIN = "http://localhost:5173"


@contextmanager
def mock_remote(**kwargs):
    remote = Mock(**kwargs)

    @contextmanager
    def stream(*args, **options):
        reply = remote(*args, **options)
        try:
            yield reply
        finally:
            reply.close()

    with patch("backend.services.supabase_gateway.httpx.stream", side_effect=stream):
        yield remote


@pytest.fixture(autouse=True)
def prohibit_real_network():
    with patch("backend.services.supabase_gateway.httpx.stream", side_effect=AssertionError("Unexpected live Supabase request")):
        yield


@pytest.fixture
def settings(tmp_path):
    return Settings(auth_provider="supabase", supabase_url="https://project.supabase.co",
                    supabase_publishable_key="sb_publishable_test", supabase_secret_key="sb_secret_test",
                    database_path=tmp_path / "limits.sqlite3", mail_directory=tmp_path / "mail",
                    mail_worker_enabled=False)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), headers={"Origin": ORIGIN}, client=("127.0.0.1", 12345)) as client:
        yield client


def response(payload, status=200):
    return httpx.Response(status, json=payload)


def identity(role="student"):
    return [response({"id": USER_ID, "email": "student@example.com", "email_confirmed_at": "2026-09-23T10:00:00Z",
                      "user_metadata": {"role": "admin"}}),
            response([{"id": USER_ID, "full_name": "Student", "role": role, "newsletter_opt_in": True}])]


def test_supabase_requires_bearer_and_does_not_accept_local_cookie(client):
    client.cookies.set("ai_sana_session", "old-local-session")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "student@example.com", "password": "anything"}).status_code == 404
    assert client.get("/api/auth/config").json()["provider"] == "supabase"


def test_remote_verification_and_rls_profile_not_untrusted_metadata(client):
    with mock_remote(side_effect=identity()) as remote:
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 200
    assert result.json()["role"] == "student"
    assert result.json()["id"] == USER_ID
    for call in remote.call_args_list:
        assert call.kwargs["headers"]["Authorization"] == "Bearer session-token"
        assert call.kwargs["headers"]["apikey"] == "sb_publishable_test"
        assert call.kwargs["follow_redirects"] is False
        assert call.kwargs["trust_env"] is False
        assert call.kwargs["timeout"] == 5
        assert "sb_secret" not in str(call)


def test_missing_profile_does_not_fabricate_one(client):
    replies = identity()
    replies[1] = response([])
    with mock_remote(side_effect=replies):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 409


@pytest.mark.parametrize("status,expected", [(401, 401), (403, 401), (429, 429), (500, 503)])
def test_provider_errors_are_safe_and_fail_closed(client, status, expected):
    with mock_remote(return_value=response({"error": "sensitive-upstream-content"}, status)):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == expected
    assert "sensitive-upstream-content" not in result.text


def test_provider_timeout_is_not_local_fallback(client):
    with mock_remote(side_effect=httpx.ReadTimeout("sensitive-url")):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 503
    assert "sensitive-url" not in result.text


def test_newsletter_requires_trusted_admin_profile(client):
    with mock_remote(side_effect=identity()):
        result = client.post("/api/mail/campaigns", headers={"Authorization": "Bearer session-token"},
                             json={"subject": "Hello", "text": "Newsletter"})
    assert result.status_code == 403


def test_admin_newsletter_uses_service_key_only_for_rpc(client):
    with mock_remote(side_effect=identity("admin") + [response({"id": 1, "queued": 2})]) as remote:
        result = client.post("/api/mail/campaigns", headers={"Authorization": "Bearer session-token"},
                             json={"subject": "Hello", "text": "Newsletter"})
    assert result.status_code == 202
    assert result.json() == {"id": 1, "queued": 2, "delivery_mode": "file"}
    rpc = remote.call_args_list[-1]
    assert rpc.kwargs["headers"]["apikey"] == "sb_secret_test"
    assert "Authorization" not in rpc.kwargs["headers"]
    assert rpc.kwargs["json"]["p_actor"] == USER_ID
    assert "sb_secret" not in result.text


def test_unsubscribe_sends_only_token_digest(client):
    token = "a" * 64
    with mock_remote(return_value=response(True)) as remote:
        result = client.post("/api/mail/unsubscribe", json={"token": token})
    assert result.status_code == 200
    assert remote.call_args.kwargs["json"] == {"p_token_hash": digest(token)}
    with mock_remote(return_value=response(False)):
        assert client.post("/api/mail/unsubscribe", json={"token": token}).status_code == 400


def test_missing_secret_disables_newsletters_not_account_verification(settings):
    with TestClient(create_app(replace(settings, supabase_secret_key="")), headers={"Origin": ORIGIN}, client=("127.0.0.1", 12345)) as client:
        with mock_remote(side_effect=identity("admin")):
            result = client.post("/api/mail/campaigns", headers={"Authorization": "Bearer session-token"},
                                 json={"subject": "Hello", "text": "Newsletter"})
        assert result.status_code == 503


def test_supabase_worker_claim_deliver_ack_and_failure_retry(settings):
    job = {"id": 1, "recipient": "subscriber@example.com", "subject": "Hello", "body": "News", "attempts": 1}
    with mock_remote(side_effect=[response([job]), httpx.Response(204), response([])]) as remote:
        assert process_outbox(settings) == 1
        ack = remote.call_args_list[1]
        assert ack.kwargs["json"]["status"] == "preview"
        assert ack.kwargs["json"]["body"] == ""
        assert ack.kwargs["params"]["attempts"] == "eq.1"
    assert len(list(settings.mail_directory.glob("*.eml"))) == 1
    with patch("backend.services.mail.deliver", side_effect=OSError("private failure")):
        with mock_remote(side_effect=[response([job]), httpx.Response(204), response([])]) as remote:
            assert process_outbox(settings) == 1
            assert remote.call_args_list[1].kwargs["json"]["status"] == "pending"
            assert remote.call_args_list[1].kwargs["json"]["last_error"] == "OSError"


def test_bearer_preflight(client):
    result = client.options("/api/auth/me", headers={"Origin": ORIGIN,
                            "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"})
    assert result.status_code == 200
    assert "Authorization" in result.headers["access-control-allow-headers"]


def test_supabase_configuration_rejects_partial_and_unsafe_urls():
    with pytest.raises(ValueError):
        Settings(auth_provider="supabase", supabase_url="https://project.supabase.co")
    with pytest.raises(ValueError):
        Settings(auth_provider="supabase", supabase_url="http://project.supabase.co", supabase_publishable_key="sb_publishable_test")
    with pytest.raises(ValueError):
        Settings(auth_provider="supabase", supabase_url="https://project.supabase.co", supabase_publishable_key="sb_secret_wrong")


@pytest.mark.parametrize("payload", [None, [], {"id": USER_ID, "email": []},
    {"id": USER_ID, "email": "student@example.com", "email_confirmed_at": True}])
def test_malformed_identity_is_sanitized(client, payload):
    with mock_remote(return_value=response(payload)):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 503


@pytest.mark.parametrize("body", [b'{"id":"one","id":"two"}', b'{"number":NaN}',
    b'{"number":1e400}', b'{"secret":"\\ud800"}', b"[" * 1500 + b"]" * 1500,
    b" " * (256 * 1024 + 1)], ids=["duplicate", "nan", "overflow", "surrogate", "depth", "size"])
def test_untrusted_json_is_bounded(client, body):
    with mock_remote(return_value=httpx.Response(200, content=body)):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 503
    assert "secret" not in result.text


def test_oversized_stream_without_content_length_stops_early(client):
    chunks = []

    def stream():
        for index in range(10):
            chunks.append(index)
            yield b" " * (64 * 1024)

    with mock_remote(return_value=httpx.Response(200, content=stream())):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 503
    assert len(chunks) == 5


def test_redirect_never_reaches_another_host(client):
    with mock_remote(return_value=httpx.Response(302, headers={"Location": "https://other.example/steal"})) as remote:
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 503
    assert remote.call_count == 1
    assert remote.call_args.kwargs["follow_redirects"] is False


def test_unsubscribe_rejects_truthy_non_boolean(client):
    with mock_remote(return_value=response({"success": False})):
        assert client.post("/api/mail/unsubscribe", json={"token": "a" * 64}).status_code == 503


def test_campaign_response_does_not_forward_extra_upstream_fields(client):
    with mock_remote(side_effect=identity("admin") + [response({"id": 1, "queued": 2, "secret": "private"})]):
        result = client.post("/api/mail/campaigns", headers={"Authorization": "Bearer session-token"},
                             json={"subject": "Hello", "text": "Newsletter"})
    assert result.status_code == 202
    assert result.json() == {"id": 1, "queued": 2, "delivery_mode": "file"}


def test_duplicate_or_malformed_bearer_never_calls_provider(client):
    with mock_remote() as remote:
        for headers in [ [("Authorization", "Bearer one"), ("Authorization", "Bearer two")],
                         {"Authorization": "Bearer invalid token"}, {"Authorization": "Bearer "} ]:
            assert client.get("/api/auth/me", headers=headers).status_code == 401
    remote.assert_not_called()


def test_production_gateway_and_supabase_session_tokens_coexist(settings):
    production = replace(settings, environment="production", api_access_token="g" * 32,
                         allowed_hosts=("api.example.com",), allowed_origins=("https://app.example.com",),
                         cookie_secure=True, auth_page_url="https://app.example.com/auth",
                         unsubscribe_page_url="https://api.example.com/account")
    with TestClient(create_app(production), base_url="https://api.example.com",
                    headers={"Origin": "https://app.example.com"}) as client:
        with mock_remote(side_effect=identity()) as remote:
            result = client.get("/api/auth/me", headers={"X-API-Access-Token": "g" * 32,
                                                         "Authorization": "Bearer session-token"})
        assert result.status_code == 200
        assert all(call.kwargs["headers"]["Authorization"] == "Bearer session-token" for call in remote.call_args_list)
        with mock_remote() as remote:
            assert client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"}).status_code == 401
            assert client.get("/api/auth/me", headers={"X-API-Access-Token": "wrong", "Authorization": "Bearer session-token"}).status_code == 401
        remote.assert_not_called()


def test_supabase_get_calls_share_request_budget(settings):
    limited = replace(settings, rate_limit_per_client=1)
    with TestClient(create_app(limited), client=("127.0.0.1", 12345), headers={"Origin": ORIGIN}) as client:
        with mock_remote(side_effect=identity()) as remote:
            assert client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"}).status_code == 200
            assert client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"}).status_code == 429
        assert remote.call_count == 2


def test_provider_selection_and_safe_settings(monkeypatch):
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_private")
    settings = Settings.from_env()
    assert settings.auth_provider == "supabase"
    assert settings.auth_page_url == "http://localhost:5173/auth"
    assert "sb_secret_private" not in repr(settings)
    monkeypatch.setenv("AUTH_PROVIDER", "local")
    assert Settings.from_env().auth_provider == "local"
    monkeypatch.delenv("AUTH_PROVIDER")
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY")
    with pytest.raises(ValueError, match="SUPABASE_PUBLISHABLE_KEY"):
        Settings.from_env()


@pytest.mark.parametrize("changes", [
    {"supabase_secret_key": "private\nheader"}, {"supabase_publishable_key": "ключ"},
    {"supabase_url": "https://project.supabase.co:bad"},
    {"supabase_url": "https://user:password@project.supabase.co"},
    {"unsubscribe_page_url": "https://user:password@example.com/account"},
])
def test_invalid_configuration_does_not_echo_credentials(settings, changes):
    with pytest.raises(ValueError) as error:
        replace(settings, **changes)
    assert all(value not in str(error.value) for value in changes.values())


def test_mail_status_preserves_only_requested_diagnostic_fields(settings):
    job = {"id": 1, "status": "pending", "attempts": 1, "last_error": "OSError"}
    with mock_remote(return_value=response([{**job, "body": "private newsletter", "recipient": "private@example.com"}])):
        assert api_call(settings, "GET", "/rest/v1/mail_outbox", admin=True) == [job]
