"""Small HTTP boundary: verified user tokens and server-only newsletter RPCs.

No client session is stored in global state and provider errors never fall back to SQLite.
"""
from collections import Counter
from uuid import UUID

import httpx
from fastapi import HTTPException, Request

from ..config import Settings


def api_call(settings: Settings, method: str, path: str, *, token: str | None = None,
             admin: bool = False, body=None, params=None):
    key = settings.supabase_secret_key if admin else settings.supabase_publishable_key
    if not key:
        raise HTTPException(503, "Серверная отправка рассылок ещё не настроена.")
    headers = {"apikey": key, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif admin and not key.startswith("sb_secret_"):
        # Compatibility for a legacy service_role JWT. New secret keys are not JWTs.
        headers["Authorization"] = f"Bearer {key}"
    try:
        response = httpx.request(method, settings.supabase_url + path, headers=headers,
                                 json=body, params=params, timeout=12, follow_redirects=False)
    except httpx.RequestError:
        raise HTTPException(503, "Сервис аккаунтов временно недоступен. Попробуйте позже.") from None
    if response.status_code == 429:
        raise HTTPException(429, "Слишком много запросов. Попробуйте позже.")
    if response.status_code in {401, 403}:
        raise HTTPException(503 if admin else 401,
                            "Сервис рассылок недоступен." if admin else "Сессия истекла. Войдите снова.")
    if not response.is_success:
        # Never return upstream payloads, URLs with credentials, or provider SQL details.
        raise HTTPException(503, "Не удалось выполнить операцию в Supabase. Проверьте настройки и миграции.")
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError:
        raise HTTPException(503, "Сервис вернул некорректный ответ.") from None


def verified_user(request: Request):
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip() or len(token) > 16384:
        raise HTTPException(401, "Войдите в аккаунт.")
    settings = request.app.state.settings
    # Let the Auth server validate the token; never trust merely decoded JWT claims.
    user = api_call(settings, "GET", "/auth/v1/user", token=token)
    try:
        user_id = str(UUID(user["id"]))
    except (TypeError, KeyError, ValueError):
        raise HTTPException(401, "Некорректная сессия.") from None
    if not user.get("email_confirmed_at"):
        raise HTTPException(403, "Подтвердите email перед входом.")
    profiles = api_call(settings, "GET", "/rest/v1/profiles", token=token,
                        params={"id": f"eq.{user_id}", "select": "id,full_name,role,newsletter_opt_in", "limit": "1"})
    if (not isinstance(profiles, list) or len(profiles) != 1 or not isinstance(profiles[0], dict)
            or profiles[0].get("id") != user_id):
        raise HTTPException(409, "Профиль аккаунта не найден. Проверьте миграцию profiles.")
    profile = profiles[0]
    if not isinstance(profile.get("full_name"), str) or not isinstance(profile.get("newsletter_opt_in"), bool):
        raise HTTPException(503, "Сервис вернул некорректный профиль.")
    if profile.get("role") not in {"student", "business", "admin"}:
        raise HTTPException(403, "Роль аккаунта не настроена.")
    return {"id": user_id, "email": user.get("email", ""), "full_name": profile["full_name"],
            "role": profile["role"], "email_verified": True,
            "newsletter_opt_in": bool(profile["newsletter_opt_in"])}


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
    jobs = api_call(settings, "GET", "/rest/v1/mail_outbox", admin=True,
                    params={"campaign_id": f"eq.{campaign_id}", "select": "status", "limit": "500"})
    return {**rows[0], "counts": dict(Counter(row["status"] for row in jobs))}
