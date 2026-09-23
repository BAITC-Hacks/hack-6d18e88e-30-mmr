import asyncio
import logging
import smtplib
import ssl
import time
from email.message import EmailMessage

from ..config import Settings
from ..database import connect
from .security import new_action_token

logger = logging.getLogger(__name__)


def enqueue(db, user, subject: str, body: str, campaign_id: int | None = None):
    db.execute("""INSERT INTO outbox (user_id, campaign_id, recipient, subject, body, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)""",
               (user["id"], campaign_id, user["email"], subject, body, int(time.time())))


def enqueue_link(db, settings: Settings, user, purpose: str):
    lifetime = 1800 if purpose == "reset" else 86400
    token = new_action_token(db, user["id"], purpose, lifetime)
    link = f"{settings.auth_page_url}#{purpose}={token}"
    subject = "Сброс пароля AI Sana" if purpose == "reset" else "Подтверждение email AI Sana"
    body = f"{subject}\n\nОткройте ссылку: {link}\n\nСсылка действует {lifetime // 60} минут и только один раз.\nЕсли это были не вы, проигнорируйте письмо."
    enqueue(db, user, subject, body)


def deliver(settings: Settings, row):
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = row["recipient"]
    message["Subject"] = row["subject"]
    message["Message-ID"] = f"<ai-sana-{row['id']}@{settings.smtp_host or 'localhost'}>"
    message.set_content(row["body"])
    if settings.mail_backend == "file":
        settings.mail_directory.mkdir(parents=True, exist_ok=True)
        (settings.mail_directory / f"{row['id']:08d}.eml").write_bytes(message.as_bytes())
        return "preview"
    context = ssl.create_default_context()
    if settings.smtp_port == 465:
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15, context=context)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
    with server:
        if settings.smtp_port != 465:
            server.starttls(context=context)
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(message)
    return "sent"


def process_outbox(settings: Settings, batch_size: int = 10):
    """Claim one message at a time; interrupted jobs become available after the lease."""
    processed = 0
    for _ in range(batch_size):
        now = int(time.time())
        with connect(settings) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("""SELECT * FROM outbox WHERE
                (status = 'pending' OR status = 'sending') AND next_attempt <= ?
                ORDER BY campaign_id IS NOT NULL, id LIMIT 1""", (now,)).fetchone()
            if row is None:
                break
            if row["campaign_id"] is not None:
                user = db.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
                if not user["newsletter_opt_in"] or not user["email_verified"]:
                    db.execute("UPDATE outbox SET status = 'skipped', body = '' WHERE id = ?", (row["id"],))
                    continue
            if row["attempts"] >= 5:
                db.execute("UPDATE outbox SET status = 'failed' WHERE id = ?", (row["id"],))
                continue
            db.execute("UPDATE outbox SET status = 'sending', attempts = attempts + 1, next_attempt = ? WHERE id = ?",
                       (now + 300, row["id"]))
        try:
            status = deliver(settings, row)
        except Exception as exc:
            # Store only the error class: SMTP exceptions may contain addresses or credentials.
            error = type(exc).__name__
            logger.warning("Mail job %s failed (%s)", row["id"], error)
            attempts = row["attempts"] + 1
            with connect(settings) as db:
                db.execute("UPDATE outbox SET status = ?, next_attempt = ?, last_error = ? WHERE id = ?",
                           ("failed" if attempts >= 5 else "pending", int(time.time()) + 60 * 2 ** attempts, error, row["id"]))
        else:
            with connect(settings) as db:
                db.execute("UPDATE outbox SET status = ?, body = '', last_error = NULL WHERE id = ?", (status, row["id"]))
        processed += 1
    return processed


async def mail_worker(settings: Settings, stop: asyncio.Event):
    while not stop.is_set():
        try:
            await asyncio.to_thread(process_outbox, settings)
            with connect(settings) as db:
                now = int(time.time())
                db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
                db.execute("DELETE FROM action_tokens WHERE expires_at <= ?", (now,))
                db.execute("DELETE FROM rate_limits WHERE expires_at <= ?", (now,))
                db.execute("DELETE FROM outbox WHERE created_at < ? AND status != 'sending'", (now - 7 * 86400,))
        except Exception:
            logger.error("Mail worker iteration failed; retrying on next tick")
        try:
            await asyncio.wait_for(stop.wait(), timeout=5)
        except asyncio.TimeoutError:
            pass
