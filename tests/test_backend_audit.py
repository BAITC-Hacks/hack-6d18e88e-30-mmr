"""Local regressions for the independent accounts/mail boundary audit."""
from contextlib import contextmanager
from dataclasses import replace
from unittest.mock import patch
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database import connect
from backend.main import create_app
from backend.services.mail import enqueue, process_outbox
from backend.services.security import COOKIE_NAME, DUMMY_PASSWORD_HASH, digest

ORIGIN = "http://localhost:8000"
USER_ID = "7dce8bc8-0d28-41c7-9058-f8cce289bfc8"


@pytest.fixture
def settings(tmp_path):
    return Settings(database_path=tmp_path / "audit.sqlite3", mail_directory=tmp_path / "mail",
                    mail_worker_enabled=False)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        yield client


def local_account(client):
    """Create an isolated verified fixture without sending mail or hashing per case."""
    with connect(client.app.state.settings) as db:
        cursor = db.execute("""INSERT INTO users
            (email, full_name, password_hash, role, email_verified, newsletter_opt_in, created_at)
            VALUES (?, ?, ?, 'student', 1, 0, ?)""",
            ("audit@example.com", "Audit User", DUMMY_PASSWORD_HASH, int(time.time())))
        user_id = cursor.lastrowid
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                   (digest("audit-isolated-session"), user_id, int(time.time()) + 3600))
    client.cookies.set(COOKIE_NAME, "audit-isolated-session")
    return {"id": user_id, "email": "audit@example.com"}


@pytest.mark.parametrize("value", [1, 0, "true", "false", "yes", [], {}])
def test_registration_consent_requires_an_explicit_json_boolean(client, value):
    result = client.post("/api/auth/register", json={
        "email": "audit@example.com", "password": "An isolated password 123!",
        "full_name": "Audit User", "newsletter_opt_in": value,
    })
    assert result.status_code == 422
    with connect(client.app.state.settings) as db:
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0


@pytest.mark.parametrize("name,expected", [("Я" * 120, 202), ("Я" * 121, 422), ("   ", 422)],
                         ids=["name-120", "name-121", "blank-name"])
def test_registration_name_matches_the_profile_contract(client, name, expected):
    with patch("backend.api.auth_routes.passwords.hash", return_value=DUMMY_PASSWORD_HASH):
        result = client.post("/api/auth/register", json={
            "email": "name-limit@example.com", "password": "An isolated password 123!",
            "full_name": name,
        })
    assert result.status_code == expected
    with connect(client.app.state.settings) as db:
        rows = db.execute("SELECT full_name FROM users").fetchall()
        assert [row["full_name"] for row in rows] == ([name] if expected == 202 else [])


@pytest.mark.parametrize("value", [1, 0, "true", "false", "yes", [], {}])
def test_preferences_never_coerce_strings_or_numbers_to_consent(client, value):
    user = local_account(client)
    result = client.patch("/api/auth/preferences", json={"newsletter_opt_in": value})
    assert result.status_code == 422
    with connect(client.app.state.settings) as db:
        assert db.execute("SELECT newsletter_opt_in FROM users WHERE id = ?", (user["id"],)).fetchone()[0] == 0


@pytest.mark.parametrize("campaign_id", [0, -1, 2**63, 10**100],
                         ids=["zero", "negative", "sqlite-overflow", "huge-integer"])
def test_campaign_identifiers_outside_the_database_range_are_client_errors(client, campaign_id):
    user = local_account(client)
    with connect(client.app.state.settings) as db:
        db.execute("UPDATE users SET role = 'admin' WHERE id = ?", (user["id"],))
    result = client.get(f"/api/mail/campaigns/{campaign_id}")
    assert result.status_code == 422
    assert "OverflowError" not in result.text


@pytest.mark.parametrize("prefix", ["", "/gateway"])
@pytest.mark.parametrize("origins", [[ORIGIN, ORIGIN], [ORIGIN, "https://evil.example"],
                                   ["https://evil.example", ORIGIN]])
def test_duplicate_origins_are_rejected_before_cookie_mutations(settings, prefix, origins):
    with TestClient(create_app(settings), base_url=ORIGIN, root_path=prefix) as client:
        result = client.post(prefix + "/api/auth/logout", headers=[
            ("Cookie", "ai_sana_session=fixture"), *(("Origin", origin) for origin in origins),
        ])
    assert result.status_code == 403
    assert "access-control-allow-origin" not in result.headers


@pytest.mark.parametrize("name,value", [("Content-Length", "2"), ("Content-Type", "application/json"),
                                      ("Content-Encoding", "identity"), ("Transfer-Encoding", "chunked")])
def test_duplicate_body_headers_are_rejected_before_account_mutations(client, name, value):
    headers = [("Content-Type", "application/json")] if name != "Content-Type" else []
    headers.extend([(name, value), (name, value)])
    result = client.post("/api/auth/logout", content=b"{}", headers=headers)
    assert result.status_code == 400
    assert result.json()["detail"]["code"] == "INVALID_HEADERS"


def test_oversized_campaign_does_not_partially_queue_mail_or_tokens(client):
    admin = local_account(client)
    with connect(client.app.state.settings) as db:
        db.execute("UPDATE users SET role = 'admin' WHERE id = ?", (admin["id"],))
        db.executemany("""INSERT INTO users
            (email, full_name, password_hash, role, email_verified, newsletter_opt_in, created_at)
            VALUES (?, 'Subscriber', ?, 'student', 1, 1, ?)""",
            [(f"subscriber-{index}@example.com", DUMMY_PASSWORD_HASH, int(time.time())) for index in range(501)])
    result = client.post("/api/mail/campaigns", json={"subject": "Fixture", "text": "Fixture campaign"})
    assert result.status_code == 400
    with connect(client.app.state.settings) as db:
        for table in ("campaigns", "outbox", "action_tokens"):
            assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


@pytest.mark.parametrize("newer_succeeds", [True, False], ids=["stale-failure", "stale-success"])
def test_expired_mail_worker_cannot_overwrite_a_newer_attempt(client, newer_succeeds):
    settings = client.app.state.settings
    user = local_account(client)
    with connect(settings) as db:
        enqueue(db, user, "Fixture", "Keep until acknowledged", html_body="<p>Fixture</p>")
    deliveries = 0

    def delivery(_settings, row):
        nonlocal deliveries
        deliveries += 1
        if deliveries == 1:
            # A paused worker's lease expires and another worker claims its job.
            with connect(settings) as db:
                db.execute("UPDATE outbox SET next_attempt = 0 WHERE id = ?", (row["id"],))
            assert process_outbox(settings, batch_size=1) == 1
            if newer_succeeds:
                raise RuntimeError("Old worker resumes with a failure")
            return "preview"
        if newer_succeeds:
            return "preview"
        raise OSError("New worker records its own retry")

    with patch("backend.services.mail.deliver", side_effect=delivery):
        assert process_outbox(settings, batch_size=1) == 1
    assert deliveries == 2
    with connect(settings) as db:
        row = db.execute("SELECT * FROM outbox").fetchone()
    assert row["attempts"] == 2
    assert row["status"] == ("preview" if newer_succeeds else "pending")
    assert row["last_error"] == (None if newer_succeeds else "OSError")
    assert row["body"] == ("" if newer_succeeds else "Keep until acknowledged")
    assert row["html_body"] == ("" if newer_succeeds else "<p>Fixture</p>")


@pytest.mark.parametrize("name", ["", "   ", "Я" * 101, "Я" * 120],
                         ids=["empty-backfilled-name", "blank-name", "101-characters", "120-characters"])
def test_supabase_profiles_accept_names_per_the_existing_sql_contract(settings, name):
    settings = replace(settings, auth_provider="supabase", supabase_url="https://project.supabase.co",
                       supabase_publishable_key="sb_publishable_test")
    replies = iter([
        {"id": USER_ID, "email": "audit@example.com", "email_confirmed_at": "2026-09-23T10:00:00Z"},
        [{"id": USER_ID, "full_name": name, "role": "student", "newsletter_opt_in": False}],
    ])

    @contextmanager
    def stream(*_args, **_kwargs):
        yield httpx.Response(200, json=next(replies))

    with patch("backend.services.supabase_gateway.httpx.stream", side_effect=stream):
        with TestClient(create_app(settings), base_url=ORIGIN) as client:
            result = client.get("/api/auth/me", headers={"Authorization": "Bearer audit-session"})
    assert result.status_code == 200
    assert result.json()["full_name"] == name
    assert result.json()["role"] == "student"
