import hashlib
import secrets
import time

from fastapi import HTTPException, Request
from pwdlib import PasswordHash

from ..database import connect

passwords = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = passwords.hash("dummy-password-for-timing-only")
COOKIE_NAME = "ai_sana_session"


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_action_token(db, user_id: int, purpose: str, lifetime: int) -> str:
    token = secrets.token_urlsafe(32)
    # Unsubscribe links in older newsletters remain valid.
    if purpose != "unsubscribe":
        db.execute("DELETE FROM action_tokens WHERE user_id = ? AND purpose = ?", (user_id, purpose))
    db.execute("INSERT INTO action_tokens VALUES (?, ?, ?, ?)",
               (digest(token), user_id, purpose, int(time.time()) + lifetime))
    return token


def consume_token(db, token: str, purpose: str) -> int:
    # Caller holds a write transaction: consumption and action commit together.
    row = db.execute("SELECT user_id FROM action_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?",
                     (digest(token), purpose, int(time.time()))).fetchone()
    if not row:
        raise HTTPException(400, "Ссылка недействительна или срок её действия истёк.")
    db.execute("DELETE FROM action_tokens WHERE token_hash = ?", (digest(token),))
    return row["user_id"]


def rate_limit(request: Request, action: str, email: str | None = None, limit: int = 10):
    now = int(time.time())
    # Do not trust client-supplied forwarding headers. Share limits between workers via SQLite.
    ip = request.client.host if request.client else "unknown"
    keys = [digest(f"{action}:ip:{ip}")]
    if email:
        keys.append(digest(f"{action}:email:{email}"))
    with connect(request.app.state.settings) as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM rate_limits WHERE expires_at <= ?", (now,))
        for key in keys:
            row = db.execute("SELECT hits FROM rate_limits WHERE key = ?", (key,)).fetchone()
            if row and row["hits"] >= limit:
                raise HTTPException(429, "Слишком много попыток. Повторите через 15 минут.", headers={"Retry-After": "900"})
        for key in keys:
            db.execute("INSERT INTO rate_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = hits + 1",
                       (key, now + 900))


def current_user(request: Request):
    if request.app.state.settings.auth_provider == "supabase":
        from .supabase_gateway import verified_user
        return verified_user(request)
    token = request.cookies.get(COOKIE_NAME, "")
    with connect(request.app.state.settings) as db:
        row = db.execute("""SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id
                            WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
                         (digest(token), int(time.time()))).fetchone()
    if not row:
        raise HTTPException(401, "Войдите в аккаунт.")
    return dict(row)


def admin_user(request: Request):
    user = current_user(request)
    if user["role"] != "admin" or not user["email_verified"]:
        raise HTTPException(403, "Нужен аккаунт администратора с подтверждённым email.")
    return user


def require_role(*roles: str):
    """Use as Depends(require_role('business')) on future protected routes."""
    def dependency(request: Request):
        user = current_user(request)
        if user["role"] not in roles:
            raise HTTPException(403, "Недостаточно прав.")
        return user
    return dependency
