"""Bounded Supabase boundary; provider errors never fall back to SQLite."""
from collections import Counter
import json
import math
import time
from uuid import UUID

import httpx
from fastapi import HTTPException, Request
from pydantic import EmailStr, TypeAdapter

from ..config import Settings

MAX_RESPONSE_BYTES = 256 * 1024
_email = TypeAdapter(EmailStr)
_mail_statuses = {"pending", "sending", "sent", "preview", "failed", "skipped"}
# No caller-controlled URL or redirect can receive a user token or service key.
_routes = {
    ("GET", "/auth/v1/user", False),
    ("GET", "/rest/v1/profiles", False),
    ("POST", "/rest/v1/rpc/queue_newsletter", True),
    ("POST", "/rest/v1/rpc/unsubscribe_mail", True),
    ("POST", "/rest/v1/rpc/claim_mail_job", True),
    ("GET", "/rest/v1/mail_campaigns", True),
    ("GET", "/rest/v1/mail_outbox", True),
    ("PATCH", "/rest/v1/mail_outbox", True),
}


def _invalid_response():
    return HTTPException(503, "Сервис аккаунтов вернул некорректный ответ. Попробуйте позже.")


def _decode_json(body: bytes):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def reject_constant(_value):
        raise ValueError("Non-finite JSON number")

    data = json.loads(body.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=reject_constant)
    pending, nodes = [(data, 0)], 0
    while pending:
        value, depth = pending.pop()
        nodes += 1
        if depth > 32 or nodes > 10000:
            raise ValueError("JSON limit")
        if isinstance(value, dict):
            pending.extend((item, depth + 1) for item in value.keys())
            pending.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, list):
            pending.extend((item, depth + 1) for item in value)
        elif isinstance(value, str):
            value.encode("utf-8")
        elif isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Non-finite JSON number")
    return data


def _text(value, maximum: int, *, single_line=False):
    if (not isinstance(value, str) or not value.strip() or len(value) > maximum
            or (single_line and any(char in value for char in "\r\n\x00"))):
        raise ValueError("Invalid text")
    return value


def _integer(value, maximum=2**63 - 1, *, minimum=1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Invalid integer")
    return value


def _validate_response(method: str, path: str, data):
    """Validate only fields we use and return no unrequested upstream fields."""
    if path == "/auth/v1/user":
        confirmed = data.get("email_confirmed_at")
        if confirmed is not None:
            _text(confirmed, 100, single_line=True)
        return {"id": str(UUID(data["id"])), "email": str(_email.validate_python(_text(data["email"], 254))),
                "email_confirmed_at": confirmed}
    if path == "/rest/v1/rpc/queue_newsletter":
        return {"id": _integer(data["id"]), "queued": _integer(data["queued"], 500, minimum=0)}
    if path == "/rest/v1/rpc/unsubscribe_mail":
        if type(data) is not bool:
            raise ValueError("Invalid unsubscribe result")
        return data
    if method == "PATCH":
        if data is not None:
            raise ValueError("Unexpected update result")
        return None
    if not isinstance(data, list) or len(data) > (500 if path == "/rest/v1/mail_outbox" else 1):
        raise ValueError("Invalid result list")
    result = []
    for row in data:
        if path == "/rest/v1/profiles":
            if type(row["newsletter_opt_in"]) is not bool or row["role"] not in {"student", "business", "admin"}:
                raise ValueError("Invalid profile")
            result.append({"id": str(UUID(row["id"])), "full_name": _text(row["full_name"], 100),
                           "role": row["role"], "newsletter_opt_in": row["newsletter_opt_in"]})
        elif path == "/rest/v1/mail_campaigns":
            result.append({"id": _integer(row["id"]), "subject": _text(row["subject"], 200, single_line=True)})
        elif path == "/rest/v1/mail_outbox":
            if row["status"] not in _mail_statuses:
                raise ValueError("Invalid mail status")
            job = {"status": row["status"]}
            # The local mail-status command requests these extra diagnostic fields.
            if "id" in row:
                job["id"] = _integer(row["id"])
            if "attempts" in row:
                job["attempts"] = _integer(row["attempts"], 5, minimum=0)
            if "last_error" in row:
                job["last_error"] = None if row["last_error"] is None else _text(row["last_error"], 200)
            result.append(job)
        elif path == "/rest/v1/rpc/claim_mail_job":
            result.append({"id": _integer(row["id"]), "attempts": _integer(row["attempts"], 5),
                           "recipient": str(_email.validate_python(_text(row["recipient"], 254))),
                           "subject": _text(row["subject"], 200, single_line=True),
                           "body": _text(row["body"], 30000)})
    return result


def api_call(settings: Settings, method: str, path: str, *, token: str | None = None,
             admin: bool = False, body=None, params=None):
    if (method, path, admin) not in _routes or settings.auth_provider != "supabase":
        raise HTTPException(503, "Операция сервиса аккаунтов не настроена.")
    key = settings.supabase_secret_key if admin else settings.supabase_publishable_key
    if not key:
        raise HTTPException(503, "Серверная отправка рассылок ещё не настроена.")
    headers = {"apikey": key, "Accept": "application/json", "Accept-Encoding": "identity"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif admin and not key.startswith("sb_secret_"):
        # Legacy service_role JWTs require Authorization; new secret keys are not JWTs.
        headers["Authorization"] = f"Bearer {key}"
    deadline = time.monotonic() + 10
    try:
        with httpx.stream(method, settings.supabase_url + path, headers=headers,
                          json=body, params=params, timeout=5, follow_redirects=False, trust_env=False) as response:
            if response.status_code == 429:
                raise HTTPException(429, "Слишком много запросов. Попробуйте позже.")
            if response.status_code in {401, 403}:
                raise HTTPException(503 if admin else 401,
                                    "Сервис рассылок недоступен." if admin else "Сессия истекла. Войдите снова.")
            if not response.is_success:
                raise HTTPException(503, "Не удалось выполнить операцию в Supabase. Попробуйте позже.")
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                raise ValueError("Unexpected compression")
            declared = response.headers.get("content-length")
            if declared is not None and (not declared.isascii() or not declared.isdecimal()
                                         or len(declared) > 10 or int(declared) > MAX_RESPONSE_BYTES):
                raise ValueError("Response length limit")
            content = bytearray()
            for chunk in response.iter_bytes():
                if time.monotonic() > deadline or len(content) + len(chunk) > MAX_RESPONSE_BYTES:
                    raise ValueError("Response limit")
                content.extend(chunk)
            data = _decode_json(bytes(content)) if content else None
            return _validate_response(method, path, data)
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError, RecursionError, OverflowError):
        # Never reflect upstream payloads, URL credentials, SQL details or malformed tokens.
        raise _invalid_response() from None


def verified_user(request: Request):
    headers = request.headers.getlist("authorization")
    scheme, _, token = headers[0].partition(" ") if len(headers) == 1 else ("", "", "")
    if (scheme.lower() != "bearer" or not token or len(token) > 16384 or not token.isascii()
            or any(ord(char) < 33 or ord(char) > 126 for char in token)):
        raise HTTPException(401, "Войдите в аккаунт.")
    settings = request.app.state.settings
    # The Auth server validates the token; never trust merely decoded JWT claims.
    user = api_call(settings, "GET", "/auth/v1/user", token=token)
    if not user["email_confirmed_at"]:
        raise HTTPException(403, "Подтвердите email перед входом.")
    profiles = api_call(settings, "GET", "/rest/v1/profiles", token=token,
                        params={"id": f"eq.{user['id']}", "select": "id,full_name,role,newsletter_opt_in", "limit": "1"})
    if len(profiles) != 1 or profiles[0]["id"] != user["id"]:
        raise HTTPException(409, "Профиль аккаунта не найден. Проверьте миграцию profiles.")
    profile = profiles[0]
    return {"id": user["id"], "email": user["email"], "full_name": profile["full_name"],
            "role": profile["role"], "email_verified": True, "newsletter_opt_in": profile["newsletter_opt_in"]}


def queue_campaign(settings: Settings, actor: str, subject: str, body: str):
    result = api_call(settings, "POST", "/rest/v1/rpc/queue_newsletter", admin=True, body={
        "p_actor": actor, "p_subject": subject, "p_text": body, "p_auth_page_url": settings.unsubscribe_page_url,
    })
    return {**result, "delivery_mode": settings.mail_backend}


def campaign_status(settings: Settings, campaign_id: int):
    rows = api_call(settings, "GET", "/rest/v1/mail_campaigns", admin=True,
                    params={"id": f"eq.{campaign_id}", "select": "id,subject", "limit": "1"})
    if not rows:
        raise HTTPException(404, "Рассылка не найдена.")
    if rows[0]["id"] != campaign_id:
        raise _invalid_response()
    jobs = api_call(settings, "GET", "/rest/v1/mail_outbox", admin=True,
                    params={"campaign_id": f"eq.{campaign_id}", "select": "status", "limit": "500"})
    return {**rows[0], "counts": dict(Counter(row["status"] for row in jobs))}
