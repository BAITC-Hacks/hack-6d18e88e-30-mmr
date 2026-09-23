import secrets
import sqlite3
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..database import connect
from ..schemas.auth import (EmailRequest, LoginRequest, MailResponse, MessageResponse, PreferencesRequest,
                            RegisterRequest, ResetPasswordRequest, TokenRequest, UserResponse)
from ..services.mail import enqueue_link
from ..services.security import (COOKIE_NAME, DUMMY_PASSWORD_HASH, consume_token, current_user,
                                 digest, passwords, rate_limit)

router = APIRouter(prefix="/auth", tags=["Accounts"])
def mail_response(request: Request):
    # This describes the global transport, never whether the account exists.
    if request.app.state.settings.mail_backend == "file":
        return {"delivery": "preview", "message": "Включён режим предпросмотра: письма сохраняются на сервере и не отправляются на почту."}
    return {"delivery": "queued", "message": "Если адрес подходит для этой операции, письмо поставлено в очередь отправки. Проверьте почту и папку «Спам»."}


@router.post("/register", response_model=MailResponse, status_code=202)
def register(payload: RegisterRequest, request: Request):
    rate_limit(request, "register", str(payload.email), limit=5)
    hashed = passwords.hash(payload.password)
    with connect(request.app.state.settings) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            cursor = db.execute("""INSERT INTO users
                (email, full_name, password_hash, role, newsletter_opt_in, created_at)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (str(payload.email), payload.full_name, hashed, payload.role, payload.newsletter_opt_in, int(time.time())))
        except sqlite3.IntegrityError:
            # A retry must send a fresh link for an unverified account, while
            # preserving its password and profile. Never disclose account state.
            user = db.execute("SELECT * FROM users WHERE email = ?", (str(payload.email),)).fetchone()
            if user is None:
                raise
            if user["email_verified"]:
                return mail_response(request)
        else:
            user = {"id": cursor.lastrowid, "email": str(payload.email)}
        enqueue_link(db, request.app.state.settings, user, "verify")
    return mail_response(request)


@router.post("/login", response_model=UserResponse)
def login(payload: LoginRequest, request: Request, response: Response):
    rate_limit(request, "login", str(payload.email))
    settings = request.app.state.settings
    with connect(settings) as db:
        user = db.execute("SELECT * FROM users WHERE email = ?", (str(payload.email),)).fetchone()
    valid = passwords.verify(payload.password, user["password_hash"] if user else DUMMY_PASSWORD_HASH)
    if not user or not valid:
        raise HTTPException(401, "Неверный email или пароль.")
    if not user["email_verified"]:
        raise HTTPException(403, "Подтвердите email перед входом.")
    token = secrets.token_urlsafe(32)
    with connect(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        # A simultaneous reset must not result in a session for the old password.
        latest = db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if latest["password_hash"] != user["password_hash"]:
            raise HTTPException(401, "Пароль изменился. Войдите повторно.")
        db.execute("DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?",
                   (digest(request.cookies.get(COOKIE_NAME, "")), int(time.time())))
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                   (digest(token), user["id"], int(time.time()) + settings.session_hours * 3600))
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=settings.cookie_secure,
                        samesite="lax", max_age=settings.session_hours * 3600, path="/api")
    return dict(user)


@router.get("/me", response_model=UserResponse)
def me(user=Depends(current_user)):
    return user


@router.post("/logout", response_model=MessageResponse)
def logout(request: Request, response: Response):
    with connect(request.app.state.settings) as db:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (digest(request.cookies.get(COOKIE_NAME, "")),))
    response.delete_cookie(COOKIE_NAME, path="/api", httponly=True,
                           secure=request.app.state.settings.cookie_secure, samesite="lax")
    return {"message": "Вы вышли из аккаунта."}


@router.post("/forgot-password", response_model=MailResponse, status_code=202)
def forgot_password(payload: EmailRequest, request: Request):
    rate_limit(request, "forgot", str(payload.email), limit=5)
    with connect(request.app.state.settings) as db:
        db.execute("BEGIN IMMEDIATE")
        user = db.execute("SELECT * FROM users WHERE email = ?", (str(payload.email),)).fetchone()
        if user:
            enqueue_link(db, request.app.state.settings, user, "reset")
    return mail_response(request)


@router.post("/resend-verification", response_model=MailResponse, status_code=202)
def resend_verification(payload: EmailRequest, request: Request):
    rate_limit(request, "verify-mail", str(payload.email), limit=5)
    with connect(request.app.state.settings) as db:
        db.execute("BEGIN IMMEDIATE")
        user = db.execute("SELECT * FROM users WHERE email = ? AND email_verified = 0", (str(payload.email),)).fetchone()
        if user:
            enqueue_link(db, request.app.state.settings, user, "verify")
    return mail_response(request)


@router.post("/verify-email", response_model=MessageResponse)
def verify_email(payload: TokenRequest, request: Request):
    rate_limit(request, "verify-token", limit=30)
    with connect(request.app.state.settings) as db:
        db.execute("BEGIN IMMEDIATE")
        user_id = consume_token(db, payload.token, "verify")
        db.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (user_id,))
    return {"message": "Email подтверждён. Теперь можно войти."}


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest, request: Request):
    rate_limit(request, "reset-token")
    hashed = passwords.hash(payload.new_password)
    with connect(request.app.state.settings) as db:
        db.execute("BEGIN IMMEDIATE")
        user_id = consume_token(db, payload.token, "reset")
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed, user_id))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return {"message": "Пароль изменён. Войдите с новым паролем."}


@router.patch("/preferences", response_model=UserResponse)
def preferences(payload: PreferencesRequest, request: Request, user=Depends(current_user)):
    with connect(request.app.state.settings) as db:
        db.execute("UPDATE users SET newsletter_opt_in = ? WHERE id = ?", (payload.newsletter_opt_in, user["id"]))
        return dict(db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
