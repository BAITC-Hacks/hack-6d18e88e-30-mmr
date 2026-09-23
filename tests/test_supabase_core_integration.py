"""User bearer and deployment bearer remain distinct after combining both apps."""
from dataclasses import replace
from contextlib import contextmanager
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient

from backend.config import Settings as AccountSettings
from backend.main import create_app
from backend.services.security import digest
from settings import Settings as ApiSettings

API_TOKEN = "gateway-only-token-with-at-least-32-characters"
USER_ID = "7dce8bc8-0d28-41c7-9058-f8cce289bfc8"
ORIGIN = "http://localhost:5173"


@contextmanager
def mock_remote(**kwargs):
    remote = Mock(**kwargs)

    @contextmanager
    def stream(*args, **options):
        response = remote(*args, **options)
        try:
            yield response
        finally:
            response.close()

    with patch("backend.services.supabase_gateway.httpx.stream", side_effect=stream):
        yield remote


def accounts_for(tmp_path):
    return AccountSettings(
        auth_provider="supabase", supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test", supabase_secret_key="sb_secret_test",
        database_path=tmp_path / "limits.sqlite3", mail_directory=tmp_path / "mail",
        mail_worker_enabled=False,
    )


def test_supabase_identity_uses_user_token_while_ai_requires_gateway_token(tmp_path):
    app = create_app(ApiSettings(api_access_token=API_TOKEN), account_settings=accounts_for(tmp_path))
    with TestClient(app, headers={"Origin": ORIGIN, "X-API-Access-Token": API_TOKEN}) as client:
        assert client.get("/api/auth/config").json()["provider"] == "supabase"
        assert client.get("/api/auth/me").status_code == 401
        responses = [
            httpx.Response(200, json={"id": USER_ID, "email": "student@example.com", "email_confirmed_at": "2026-09-23T10:00:00Z"}),
            httpx.Response(200, json=[{"id": USER_ID, "full_name": "Student", "role": "student", "newsletter_opt_in": False}]),
        ]
        with mock_remote(side_effect=responses) as remote:
            result = client.get("/api/auth/me", headers={"Authorization": "Bearer user-session"})
        assert result.status_code == 200 and result.json()["id"] == USER_ID
        assert all(call.kwargs["headers"]["Authorization"] == "Bearer user-session" for call in remote.call_args_list)
        assert client.get("/api/ai/inspector", headers={"Authorization": "Bearer user-session", "X-API-Access-Token": "wrong"}).status_code == 401
        assert client.get("/api/ai/inspector", headers={"Authorization": f"Bearer {API_TOKEN}"}).status_code == 200
        # Missing or wrong account methods never expand the deployment boundary.
        for path in ("/api/auth/login", "/api/auth/me/", "/api/auth/config/extra"):
            assert client.get(path, headers={"X-API-Access-Token": "wrong"}).json()["detail"]["code"] == "UNAUTHORIZED"
        assert client.post("/api/auth/config", json={}, headers={"X-API-Access-Token": "wrong"}).status_code == 401
        preflight = client.options("/api/auth/me", headers={
            "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization",
        })
        assert preflight.status_code == 200
        assert "Authorization" in preflight.headers["access-control-allow-headers"]


def test_old_local_cookie_does_not_break_supabase_action_tokens(tmp_path):
    app = create_app(ApiSettings(api_access_token=API_TOKEN), account_settings=accounts_for(tmp_path))
    with TestClient(app, headers={"X-API-Access-Token": API_TOKEN}) as client:
        client.cookies.set("ai_sana_session", "obsolete-local-cookie")
        token = "a" * 64
        with mock_remote(return_value=httpx.Response(200, json=True)) as remote:
            result = client.post("/api/mail/unsubscribe", json={"token": token})
        assert result.status_code == 200
        assert remote.call_args.kwargs["json"] == {"p_token_hash": digest(token)}
        # The same action still respects the outer origin guard and JSON parser.
        assert client.post("/api/mail/unsubscribe", json={"token": token}, headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.post("/api/mail/unsubscribe", content='{"token":"one","token":"two"}',
                           headers={"Content-Type": "application/json"}).status_code == 400


def test_supabase_without_service_key_never_starts_newsletter_worker(tmp_path):
    accounts = replace(accounts_for(tmp_path), mail_worker_enabled=True, supabase_secret_key="")
    with patch("backend.main.mail_worker") as worker:
        with TestClient(create_app(ApiSettings(), account_settings=accounts)) as client:
            assert client.get("/health").status_code == 200
    worker.assert_not_called()
