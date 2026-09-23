from dataclasses import replace
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.services.mail import process_outbox
from backend.services.security import digest

USER_ID = "7dce8bc8-0d28-41c7-9058-f8cce289bfc8"
ORIGIN = "http://localhost:5173"


@pytest.fixture
def settings(tmp_path):
    return Settings(auth_provider="supabase", supabase_url="https://project.supabase.co",
                    supabase_publishable_key="sb_publishable_test", supabase_secret_key="sb_secret_test",
                    database_path=tmp_path / "limits.sqlite3", mail_directory=tmp_path / "mail",
                    mail_worker_enabled=False)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), headers={"Origin": ORIGIN}) as client:
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
    with patch("backend.services.supabase_gateway.httpx.request", side_effect=identity()) as remote:
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 200
    assert result.json()["role"] == "student"
    assert result.json()["id"] == USER_ID
    for call in remote.call_args_list:
        assert call.kwargs["headers"]["Authorization"] == "Bearer session-token"
        assert call.kwargs["headers"]["apikey"] == "sb_publishable_test"
        assert "sb_secret" not in str(call)


def test_missing_profile_does_not_fabricate_one(client):
    replies = identity()
    replies[1] = response([])
    with patch("backend.services.supabase_gateway.httpx.request", side_effect=replies):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 409


@pytest.mark.parametrize("status,expected", [(401, 401), (403, 401), (429, 429), (500, 503)])
def test_provider_errors_are_safe_and_fail_closed(client, status, expected):
    with patch("backend.services.supabase_gateway.httpx.request", return_value=response({"error": "sensitive-upstream-content"}, status)):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == expected
    assert "sensitive-upstream-content" not in result.text


def test_provider_timeout_is_not_local_fallback(client):
    with patch("backend.services.supabase_gateway.httpx.request", side_effect=httpx.ReadTimeout("sensitive-url")):
        result = client.get("/api/auth/me", headers={"Authorization": "Bearer session-token"})
    assert result.status_code == 503
    assert "sensitive-url" not in result.text


def test_newsletter_requires_trusted_admin_profile(client):
    with patch("backend.services.supabase_gateway.httpx.request", side_effect=identity()):
        result = client.post("/api/mail/campaigns", headers={"Authorization": "Bearer session-token"},
                             json={"subject": "Hello", "text": "Newsletter"})
    assert result.status_code == 403


def test_admin_newsletter_uses_service_key_only_for_rpc(client):
    with patch("backend.services.supabase_gateway.httpx.request", side_effect=identity("admin") + [response({"id": 1, "queued": 2})]) as remote:
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
    with patch("backend.services.supabase_gateway.httpx.request", return_value=response(True)) as remote:
        result = client.post("/api/mail/unsubscribe", json={"token": token})
    assert result.status_code == 200
    assert remote.call_args.kwargs["json"] == {"p_token_hash": digest(token)}
    with patch("backend.services.supabase_gateway.httpx.request", return_value=response(False)):
        assert client.post("/api/mail/unsubscribe", json={"token": token}).status_code == 400


def test_missing_secret_disables_newsletters_not_account_verification(settings):
    with TestClient(create_app(replace(settings, supabase_secret_key="")), headers={"Origin": ORIGIN}) as client:
        with patch("backend.services.supabase_gateway.httpx.request", side_effect=identity("admin")):
            result = client.post("/api/mail/campaigns", headers={"Authorization": "Bearer session-token"},
                                 json={"subject": "Hello", "text": "Newsletter"})
        assert result.status_code == 503


def test_supabase_worker_claim_deliver_ack_and_failure_retry(settings):
    job = {"id": 1, "recipient": "subscriber@example.com", "subject": "Hello", "body": "News", "attempts": 1}
    with patch("backend.services.supabase_gateway.httpx.request", side_effect=[response([job]), httpx.Response(204), response([])]) as remote:
        assert process_outbox(settings) == 1
        ack = remote.call_args_list[1]
        assert ack.kwargs["json"]["status"] == "preview"
        assert ack.kwargs["json"]["body"] == ""
        assert ack.kwargs["params"]["attempts"] == "eq.1"
    assert len(list(settings.mail_directory.glob("*.eml"))) == 1
    with patch("backend.services.mail.deliver", side_effect=OSError("private failure")):
        with patch("backend.services.supabase_gateway.httpx.request", side_effect=[response([job]), httpx.Response(204), response([])]) as remote:
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
