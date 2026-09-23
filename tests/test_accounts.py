import re
import time
from dataclasses import replace
from email import policy
from email.parser import BytesParser
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database import connect
from backend.main import create_app
from backend.services.mail import deliver, process_outbox
from backend.services.security import COOKIE_NAME, digest

PASSWORD = "A strong password 123!"
ORIGIN = "http://localhost:8000"


@pytest.fixture
def client(tmp_path):
    settings = Settings(database_path=tmp_path / "accounts.sqlite3", mail_directory=tmp_path / "mail", mail_worker_enabled=False)
    with TestClient(create_app(settings), base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        yield client


def latest_token(client, purpose, email="person@example.com"):
    with connect(client.app.state.settings) as db:
        body = db.execute("SELECT body FROM outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1", (email,)).fetchone()["body"]
    return re.search(rf"#{purpose}=([\w-]+)", body).group(1)


def register(client, email="person@example.com", verified=True, opted_in=False, role="student"):
    response = client.post("/api/auth/register", json={"email": email, "password": PASSWORD, "full_name": "Test Person", "role": role, "newsletter_opt_in": opted_in})
    assert response.status_code == 202
    if verified:
        assert client.post("/api/auth/verify-email", json={"token": latest_token(client, "verify", email)}).status_code == 200


def login(client, email="person@example.com", password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def make_admin(client):
    register(client)
    with connect(client.app.state.settings) as db:
        db.execute("UPDATE users SET role = 'admin' WHERE email = 'person@example.com'")
    assert login(client).status_code == 200


def test_registration_verification_login_logout_and_persistence(client):
    register(client, verified=False)
    assert login(client).status_code == 403
    token = latest_token(client, "verify")
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400
    response = login(client, email="PERSON@EXAMPLE.COM")
    assert response.status_code == 200
    assert "password_hash" not in response.json()
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    token = client.cookies.get(COOKIE_NAME)
    assert client.get("/api/auth/me").json()["role"] == "student"
    with connect(client.app.state.settings) as db:
        assert db.execute("SELECT token_hash FROM sessions").fetchone()[0] == digest(token)
        assert db.execute("SELECT password_hash FROM users").fetchone()[0].startswith("$argon2id$")
    with TestClient(create_app(client.app.state.settings), base_url=ORIGIN) as restarted:
        restarted.cookies.set(COOKIE_NAME, token)
        assert restarted.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, token)
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("changes", [
    {"role": "admin"}, {"email": "not-an-email"}, {"password": "short"},
    {"full_name": "   "}, {"email_verified": True}, {"password": "x" * 129},
])
def test_registration_validation_and_no_privilege_escalation(client, changes):
    data = {"email": "person@example.com", "password": PASSWORD, "full_name": "Test", **changes}
    assert client.post("/api/auth/register", json=data).status_code == 422


def test_duplicate_email_is_normalized_and_does_not_overwrite(client):
    register(client)
    register(client, email=" PERSON@EXAMPLE.COM ", verified=False, role="business")
    with connect(client.app.state.settings) as db:
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert db.execute("SELECT role FROM users").fetchone()[0] == "student"


def test_reset_is_single_use_revokes_all_sessions_and_cannot_authenticate(client):
    register(client)
    assert login(client).status_code == 200
    old_session = client.cookies.get(COOKIE_NAME)
    with TestClient(create_app(client.app.state.settings), base_url=ORIGIN, headers={"Origin": ORIGIN}) as second_device:
        assert login(second_device).status_code == 200
        other_session = second_device.cookies.get(COOKIE_NAME)
    assert client.post("/api/auth/forgot-password", json={"email": "person@example.com"}).status_code == 202
    reset_token = latest_token(client, "reset")
    new_password = "A different password 456!"
    body = {"token": reset_token, "new_password": new_password}
    assert client.post("/api/auth/reset-password", json=body).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/reset-password", json=body).status_code == 400
    assert login(client).status_code == 401
    assert login(client, password=new_password).status_code == 200
    client.cookies.clear()
    client.cookies.set(COOKIE_NAME, old_session)
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, other_session)
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set(COOKIE_NAME, reset_token)
    assert client.get("/api/auth/me").status_code == 401


def test_expired_and_wrong_purpose_tokens_do_not_change_password(client):
    register(client, verified=False)
    verification_token = latest_token(client, "verify")
    assert client.post("/api/auth/reset-password", json={"token": verification_token, "new_password": PASSWORD}).status_code == 400
    client.post("/api/auth/forgot-password", json={"email": "person@example.com"})
    reset_token = latest_token(client, "reset")
    with connect(client.app.state.settings) as db:
        db.execute("UPDATE action_tokens SET expires_at = ? WHERE purpose = 'reset'", (int(time.time()) - 1,))
    assert client.post("/api/auth/reset-password", json={"token": reset_token, "new_password": PASSWORD}).status_code == 400


def test_new_reset_invalidates_previous_link(client):
    register(client)
    for _ in range(2):
        client.post("/api/auth/forgot-password", json={"email": "person@example.com"})
        if _ == 0:
            first = latest_token(client, "reset")
    assert client.post("/api/auth/reset-password", json={"token": first, "new_password": PASSWORD}).status_code == 400
    assert client.post("/api/auth/reset-password", json={"token": latest_token(client, "reset"), "new_password": PASSWORD}).status_code == 200


def test_generic_recovery_and_login_errors(client):
    register(client)
    known = client.post("/api/auth/forgot-password", json={"email": "person@example.com"})
    unknown = client.post("/api/auth/forgot-password", json={"email": "missing@example.com"})
    assert known.json() == unknown.json()
    assert login(client, password="wrong").json() == login(client, email="missing@example.com").json()


def test_rate_limit_and_csrf(client):
    register(client)
    assert login(client).status_code == 200
    assert client.patch("/api/auth/preferences", json={"newsletter_opt_in": True}, headers={"Origin": "https://evil.example"}).status_code == 403
    del client.headers["Origin"]
    assert client.post("/api/auth/logout").status_code == 403
    client.headers["Origin"] = ORIGIN
    for _ in range(5):
        assert client.post("/api/auth/forgot-password", json={"email": "person@example.com"}).status_code == 202
    assert client.post("/api/auth/forgot-password", json={"email": "person@example.com"}).status_code == 429


def test_session_expiry(client):
    register(client)
    login(client)
    with connect(client.app.state.settings) as db:
        db.execute("UPDATE sessions SET expires_at = 0")
    assert client.get("/api/auth/me").status_code == 401


def test_campaign_requires_admin_and_verified_opt_in_and_supports_unsubscribe(client):
    payload = {"subject": "Новости", "text": "Новые задачи для команд"}
    assert client.post("/api/mail/campaigns", json=payload).status_code == 401
    register(client, opted_in=True)
    login(client)
    assert client.post("/api/mail/campaigns", json=payload).status_code == 403
    with connect(client.app.state.settings) as db:
        db.execute("UPDATE users SET role = 'admin' WHERE email = 'person@example.com'")
    register(client, email="unverified@example.com", verified=False, opted_in=True)
    register(client, email="optout@example.com", opted_in=False)
    response = client.post("/api/mail/campaigns", json=payload)
    assert response.status_code == 202
    assert response.json()["queued"] == 1
    campaign_id = response.json()["id"]
    assert client.get(f"/api/mail/campaigns/{campaign_id}").json()["counts"] == {"pending": 1}
    token = latest_token(client, "unsubscribe")
    assert client.post("/api/mail/unsubscribe", json={"token": token}).status_code == 200
    process_outbox(client.app.state.settings)
    assert client.get(f"/api/mail/campaigns/{campaign_id}").json()["counts"] == {"skipped": 1}
    assert client.post("/api/mail/campaigns", json=payload).json()["queued"] == 0


def test_preferences_are_self_only(client):
    register(client)
    assert client.patch("/api/auth/preferences", json={"newsletter_opt_in": True}).status_code == 401
    login(client)
    assert client.patch("/api/auth/preferences", json={"newsletter_opt_in": True, "role": "admin"}).status_code == 422
    assert client.patch("/api/auth/preferences", json={"newsletter_opt_in": True}).json()["newsletter_opt_in"] is True


def test_file_delivery_is_preview_not_sent_and_does_not_duplicate(client):
    register(client, verified=False)
    settings = client.app.state.settings
    assert process_outbox(settings) == 1
    assert process_outbox(settings) == 0
    files = list(settings.mail_directory.glob("*.eml"))
    assert len(files) == 1
    message = BytesParser(policy=policy.default).parsebytes(files[0].read_bytes())
    assert "#verify=" in message.get_body(preferencelist=("plain",)).get_content()
    html = message.get_body(preferencelist=("html",)).get_content()
    assert "#verify=" in html and "AI SANA" in html
    assert message["To"] == "person@example.com"
    with connect(settings) as db:
        row = db.execute("SELECT * FROM outbox").fetchone()
        assert row["status"] == "preview"
        assert row["body"] == ""


@pytest.mark.parametrize("transport", ["file", "smtp"])
def test_mail_actions_describe_transport_without_disclosing_accounts(client, transport):
    settings = replace(client.app.state.settings, mail_backend=transport, smtp_host="smtp.example.com",
                       mail_from="sender@example.com")
    client.app.state.settings = settings
    data = {"email": "person@example.com", "password": PASSWORD, "full_name": "Test"}
    created = client.post("/api/auth/register", json=data)
    duplicate = client.post("/api/auth/register", json=data)
    assert created.status_code == duplicate.status_code == 202
    assert created.json() == duplicate.json()
    assert created.json()["delivery"] == ("preview" if transport == "file" else "queued")
    for endpoint in ("forgot-password", "resend-verification"):
        existing = client.post(f"/api/auth/{endpoint}", json={"email": "person@example.com"})
        unknown = client.post(f"/api/auth/{endpoint}", json={"email": "unknown@example.com"})
        assert existing.status_code == unknown.status_code == 202
        assert existing.json() == unknown.json() == created.json()
    with connect(settings) as db:
        assert {row[0] for row in db.execute("SELECT status FROM outbox")} == {"pending"}


@pytest.mark.parametrize("overrides", [
    {"smtp_port": 0}, {"smtp_port": 65536},
    {"mail_from": "noreply@example.com"}, {"mail_from": "broken"},
    {"mail_from": "sender@example.com\r\nBcc: other@example.com"},
    {"mail_from": "one@example.com, two@example.com"},
    {"smtp_host": "smtp.gmail.com", "smtp_user": "", "smtp_password": ""},
])
def test_rejects_invalid_smtp_configuration(overrides):
    values = {"mail_backend": "smtp", "smtp_host": "smtp.example.com", "mail_from": "sender@example.com"}
    with pytest.raises(ValueError):
        Settings(**(values | overrides))


def test_delivery_failure_is_persisted_and_retried_after_restart(client):
    register(client, verified=False)
    settings = client.app.state.settings
    with patch("backend.services.mail.deliver", side_effect=OSError("secret error content")):
        assert process_outbox(settings) == 1
    with connect(settings) as db:
        row = db.execute("SELECT * FROM outbox").fetchone()
        assert row["status"] == "pending"
        assert row["last_error"] == "OSError"
        assert row["attempts"] == 1
        db.execute("UPDATE outbox SET next_attempt = 0")
    with TestClient(create_app(settings), base_url=ORIGIN):
        assert process_outbox(settings) == 1
    with connect(settings) as db:
        assert db.execute("SELECT status FROM outbox").fetchone()[0] == "preview"


@pytest.mark.parametrize("mail_format", ["text", "html"])
@pytest.mark.parametrize("purpose", ["verify", "reset"])
def test_auth_email_formats_preserve_single_use_links(client, mail_format, purpose):
    settings = replace(client.app.state.settings, auth_mail_format=mail_format)
    client.app.state.settings = settings
    register(client, verified=False)
    if purpose == "reset":
        assert client.post("/api/auth/forgot-password", json={"email": "person@example.com"}).status_code == 202
    token = latest_token(client, purpose)
    with connect(settings) as db:
        job_id = db.execute("SELECT MAX(id) FROM outbox").fetchone()[0]
    process_outbox(settings)
    message = BytesParser(policy=policy.default).parsebytes((settings.mail_directory / f"{job_id:08d}.eml").read_bytes())
    assert f"#{purpose}={token}" in message.get_body(preferencelist=("plain",)).get_content()
    html = message.get_body(preferencelist=("html",))
    if mail_format == "html":
        assert html is not None and f"#{purpose}={token}" in html.get_content()
    else:
        assert html is None and message.get_content_type() == "text/plain"
    route = "verify-email" if purpose == "verify" else "reset-password"
    payload = {"token": token}
    if purpose == "reset":
        payload["new_password"] = "Another strong password 456!"
    assert client.post(f"/api/auth/{route}", json=payload).status_code == 200
    assert client.post(f"/api/auth/{route}", json=payload).status_code == 400


@pytest.mark.parametrize("port", [465, 587])
def test_smtp_tls_and_credentials(client, port):
    settings = replace(client.app.state.settings, mail_backend="smtp", smtp_host="smtp.example.com", smtp_port=port,
                       smtp_user="sender@example.com", smtp_password="test-password", mail_from="sender@example.com")
    row = {"id": 1, "recipient": "person@example.com", "subject": "Test", "body": "Body"}
    server = MagicMock()
    server.__enter__.return_value = server
    target = "backend.services.mail.smtplib.SMTP_SSL" if port == 465 else "backend.services.mail.smtplib.SMTP"
    with patch(target, return_value=server):
        assert deliver(settings, row) == "sent"
    server.login.assert_called_once_with("sender@example.com", "test-password")
    server.send_message.assert_called_once()
    assert server.starttls.call_count == (0 if port == 465 else 1)


def test_campaign_preview_delivery_and_subject_injection(client):
    make_admin(client)
    client.patch("/api/auth/preferences", json={"newsletter_opt_in": True})
    assert client.post("/api/mail/campaigns", json={"subject": "hello\r\nBcc: someone@example.com", "text": "text"}).status_code == 422
    campaign_id = client.post("/api/mail/campaigns", json={"subject": "Новости", "text": "Привет"}).json()["id"]
    process_outbox(client.app.state.settings)
    assert client.get(f"/api/mail/campaigns/{campaign_id}").json()["counts"] == {"preview": 1}


def test_health_account_and_existing_ai_contract(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/api/health").status_code == 200
    page = client.get("/account")
    assert page.status_code == 200
    assert page.headers["referrer-policy"] == "no-referrer"
    assert "script-src 'self'" in page.headers["content-security-policy"]
    assert client.get("/account.js").status_code == 200
    assert client.get("/account.css").status_code == 200
    assert client.get("/email-preview/recovery").status_code == 200
    assert client.get("/email-preview/confirmation").status_code == 200
    assert client.get("/email-preview/unknown").status_code == 422
    assert client.get("/api/auth/me").headers["cache-control"] == "no-store"
    result = client.post("/api/ai/analyze", json={"draft": "Нужен бот для автоматизации обработки заявок клиентов"})
    assert result.status_code == 200
    assert result.json()["provider"] == "local-fallback-nlp"
    assert result.json()["fallbackUsed"] is True


def test_frontend_cors_and_https_cookie(client):
    preflight = client.options("/api/auth/login", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert preflight.headers["access-control-allow-credentials"] == "true"
    settings = replace(client.app.state.settings, cookie_secure=True, allowed_origins=("https://example.com",), allowed_hosts=("example.com",))
    with TestClient(create_app(settings), base_url="https://example.com", headers={"Origin": "https://example.com"}) as secure:
        register(secure)
        response = login(secure)
        assert "Secure" in response.headers["set-cookie"]
        assert secure.get("/api/auth/me").status_code == 200
