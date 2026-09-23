import re
from dataclasses import replace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database import connect
from backend.main import create_app
from backend.services.mail import process_outbox


EMAIL = "retry@example.com"
PASSWORD = "Original secure password 123!"
REGISTRATION = {
    "email": EMAIL,
    "password": PASSWORD,
    "full_name": "Original Person",
    "role": "student",
    "newsletter_opt_in": False,
}


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        database_path=tmp_path / "accounts.sqlite3",
        mail_directory=tmp_path / "mail",
        mail_worker_enabled=False,
    )
    origin = "http://localhost:8000"
    with TestClient(create_app(settings), base_url=origin, headers={"Origin": origin}) as client:
        yield client


def latest_verification_token(client):
    with connect(client.app.state.settings) as db:
        row = db.execute("SELECT body FROM outbox ORDER BY id DESC LIMIT 1").fetchone()
    return re.search(r"#verify=([\w-]+)", row["body"]).group(1)


def test_duplicate_unverified_registration_after_preview_queues_fresh_link_without_overwriting(client):
    assert client.post("/api/auth/register", json=REGISTRATION).status_code == 202
    old_token = latest_verification_token(client)
    with connect(client.app.state.settings) as db:
        original_user = dict(db.execute("SELECT * FROM users").fetchone())
    # Reproduce registration before SMTP was configured, followed by a retry.
    assert process_outbox(client.app.state.settings) == 1
    client.app.state.settings = replace(
        client.app.state.settings,
        mail_backend="smtp",
        smtp_host="smtp.example.com",
        mail_from="sender@example.com",
    )
    response = client.post("/api/auth/register", json={
        **REGISTRATION,
        "email": " RETRY@EXAMPLE.COM ",
        "password": "Replacement password 456!",
        "full_name": "Another Person",
        "role": "business",
        "newsletter_opt_in": True,
    })
    assert response.status_code == 202
    assert response.json()["delivery"] == "queued"
    new_token = latest_verification_token(client)
    assert new_token != old_token
    with connect(client.app.state.settings) as db:
        assert [dict(row) for row in db.execute("SELECT * FROM users")] == [original_user]
        assert [tuple(row) for row in db.execute("SELECT recipient, status FROM outbox ORDER BY id")] == [
            (EMAIL, "preview"), (EMAIL, "pending"),
        ]
        assert db.execute("SELECT COUNT(*) FROM action_tokens WHERE purpose = 'verify'").fetchone()[0] == 1
    assert client.post("/api/auth/verify-email", json={"token": old_token}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": new_token}).status_code == 200
    assert client.post("/api/auth/verify-email", json={"token": new_token}).status_code == 400
    assert client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code == 200
    assert client.post("/api/auth/login", json={
        "email": EMAIL, "password": "Replacement password 456!",
    }).status_code == 401


def test_duplicate_verified_registration_does_not_enqueue_or_disclose_account_state(client):
    created = client.post("/api/auth/register", json=REGISTRATION)
    assert client.post("/api/auth/verify-email", json={
        "token": latest_verification_token(client),
    }).status_code == 200
    with connect(client.app.state.settings) as db:
        original_user = dict(db.execute("SELECT * FROM users").fetchone())
    duplicate = client.post("/api/auth/register", json={**REGISTRATION, "role": "business"})
    assert duplicate.status_code == created.status_code == 202
    assert duplicate.json() == created.json()
    with connect(client.app.state.settings) as db:
        assert [dict(row) for row in db.execute("SELECT * FROM users")] == [original_user]
        assert db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM action_tokens").fetchone()[0] == 0


def test_duplicate_registration_keeps_rate_limit_and_does_not_invalidate_link_on_rejection(client):
    for _ in range(5):
        assert client.post("/api/auth/register", json=REGISTRATION).status_code == 202
    token = latest_verification_token(client)
    rejected = client.post("/api/auth/register", json=REGISTRATION)
    assert rejected.status_code == 429
    assert rejected.headers["Retry-After"] == "900"
    with connect(client.app.state.settings) as db:
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] == 5
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200


def test_duplicate_enqueue_failure_rolls_back_token_rotation(client):
    assert client.post("/api/auth/register", json=REGISTRATION).status_code == 202
    token = latest_verification_token(client)
    # Token rotation occurs before queue insertion; both must roll back together.
    with patch("backend.services.mail.enqueue", side_effect=RuntimeError("queue unavailable")):
        with pytest.raises(RuntimeError, match="queue unavailable"):
            client.post("/api/auth/register", json=REGISTRATION)
    with connect(client.app.state.settings) as db:
        assert db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0] == 1
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
