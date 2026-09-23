import asyncio
import logging
import smtplib
import ssl
import time
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from ..config import Settings
from ..database import connect
from .security import new_action_token
from .email_templates import action_email

logger = logging.getLogger(__name__)


def enqueue(db, user, subject: str, body: str, campaign_id: int | None = None, html_body: str = ""):
    db.execute("""INSERT INTO outbox (user_id, campaign_id, recipient, subject, body, created_at, html_body)
                  VALUES (?, ?, ?, ?, ?, ?, ?)""",
               (user["id"], campaign_id, user["email"], subject, body, int(time.time()), html_body))


def enqueue_link(db, settings: Settings, user, purpose: str):
    lifetime = 1800 if purpose == "reset" else 86400
    token = new_action_token(db, user["id"], purpose, lifetime)
    link = f"{settings.auth_page_url}#{purpose}={token}"
    subject = "Восстановление доступа к AI Sana" if purpose == "reset" else "Подтвердите почту в AI Sana"
    body = f"{subject}\n\nОткройте ссылку: {link}\n\nСсылка действует {lifetime // 60} минут и только один раз.\nЕсли это были не вы, проигнорируйте письмо."
    html_body = action_email(
        "Вернём вас к вашим проектам" if purpose == "reset" else "Добро пожаловать в AI Sana",
        "Получили запрос на смену пароля вашего аккаунта. Нажмите кнопку ниже, чтобы задать новый пароль."
        if purpose == "reset" else "Остался один шаг: подтвердите почту, чтобы начать работу с бизнес-задачами и командами.",
        link, "Задать новый пароль" if purpose == "reset" else "Подтвердить почту", lifetime // 60,
    ) if settings.auth_mail_format == "html" else ""
    enqueue(db, user, subject, body, html_body=html_body)


def build_message(settings: Settings, row):
    row = dict(row)
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = row["recipient"]
    message["Subject"] = row["subject"]
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid(idstring="ai-sana")
    message.set_content(row["body"])
    if row.get("html_body"):
        message.add_alternative(row["html_body"], subtype="html")
    return message


@contextmanager
def smtp_connection(settings: Settings):
    """Use the same verified TLS and authentication path for delivery and diagnostics."""
    context = ssl.create_default_context()
    if settings.smtp_port == 465:
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15, context=context)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
    with server:
        if settings.smtp_port != 465:
            server.starttls(context=context)
            server.ehlo()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        yield server


def deliver(settings: Settings, row):
    message = build_message(settings, row)
    if settings.mail_backend == "file":
        settings.mail_directory.mkdir(parents=True, exist_ok=True)
        (settings.mail_directory / f"{row['id']:08d}.eml").write_bytes(message.as_bytes())
        return "preview"
    with smtp_connection(settings) as server:
        server.send_message(message)
    return "sent"


def process_outbox(settings: Settings, batch_size: int = 10):
    """Claim one message at a time; interrupted jobs become available after the lease."""
    if settings.auth_provider == "supabase":
        return process_supabase_outbox(settings, batch_size)
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
                    db.execute("UPDATE outbox SET status = 'skipped', body = '', html_body = '' WHERE id = ?", (row["id"],))
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
                db.execute("UPDATE outbox SET status = ?, body = '', html_body = '', last_error = NULL WHERE id = ?", (status, row["id"]))
        processed += 1
    return processed


def process_supabase_outbox(settings: Settings, batch_size: int = 10):
    from .supabase_gateway import api_call
    processed = 0
    for _ in range(batch_size):
        rows = api_call(settings, "POST", "/rest/v1/rpc/claim_mail_job", admin=True,
                        body={"p_now": int(time.time())})
        if not rows:
            break
        row = rows[0]
        try:
            status = deliver(settings, row)
        except Exception as exc:
            attempts = row["attempts"]  # RPC already increments the attempt counter.
            update = {"status": "failed" if attempts >= 5 else "pending", "last_error": type(exc).__name__,
                      "next_attempt": int(time.time()) + 60 * 2 ** attempts}
            logger.warning("Supabase mail job %s failed (%s)", row["id"], type(exc).__name__)
        else:
            update = {"status": status, "body": "", "last_error": None}
        api_call(settings, "PATCH", "/rest/v1/mail_outbox", admin=True, body=update,
                 params={"id": f"eq.{row['id']}", "attempts": f"eq.{row['attempts']}", "status": "eq.sending"})
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
        except TimeoutError:
            pass
