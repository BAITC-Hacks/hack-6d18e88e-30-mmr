import time

from fastapi import APIRouter, Depends, HTTPException, Request

from ..database import connect
from ..schemas.auth import CampaignRequest, MessageResponse, TokenRequest
from ..services.mail import enqueue
from ..services.security import admin_user, consume_token, new_action_token, rate_limit
from ..services.security import digest
from ..services import supabase_gateway

router = APIRouter(prefix="/mail", tags=["Mail"])


@router.post("/campaigns", status_code=202)
def create_campaign(payload: CampaignRequest, request: Request, admin=Depends(admin_user)):
    rate_limit(request, "campaign", limit=3)
    settings = request.app.state.settings
    if settings.auth_provider == "supabase":
        return supabase_gateway.queue_campaign(settings, admin["id"], payload.subject, payload.text)
    with connect(settings) as db:
        db.execute("BEGIN IMMEDIATE")
        users = db.execute("SELECT * FROM users WHERE email_verified = 1 AND newsletter_opt_in = 1").fetchall()
        if len(users) > 500:
            raise HTTPException(400, "Лимит MVP — 500 получателей. Нужен отдельный сервис рассылок.")
        cursor = db.execute("INSERT INTO campaigns (subject, created_by, created_at) VALUES (?, ?, ?)",
                            (payload.subject, admin["id"], int(time.time())))
        campaign_id = cursor.lastrowid
        for user in users:
            token = new_action_token(db, user["id"], "unsubscribe", 365 * 86400)
            body = f"{payload.text}\n\nВы подписались на новости AI Sana.\nОтписаться: {settings.unsubscribe_page_url}#unsubscribe={token}"
            enqueue(db, user, payload.subject, body, campaign_id)
    return {"id": campaign_id, "queued": len(users), "delivery_mode": settings.mail_backend}


@router.get("/campaigns/{campaign_id}")
def campaign_status(campaign_id: int, request: Request, admin=Depends(admin_user)):
    if request.app.state.settings.auth_provider == "supabase":
        return supabase_gateway.campaign_status(request.app.state.settings, campaign_id)
    with connect(request.app.state.settings) as db:
        campaign = db.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
        if not campaign:
            raise HTTPException(404, "Рассылка не найдена.")
        counts = db.execute("SELECT status, COUNT(*) AS count FROM outbox WHERE campaign_id = ? GROUP BY status", (campaign_id,)).fetchall()
    return {"id": campaign_id, "subject": campaign["subject"], "counts": {row["status"]: row["count"] for row in counts}}


@router.post("/unsubscribe", response_model=MessageResponse)
def unsubscribe(payload: TokenRequest, request: Request):
    rate_limit(request, "unsubscribe", limit=30)
    if request.app.state.settings.auth_provider == "supabase":
        consumed = supabase_gateway.api_call(request.app.state.settings, "POST", "/rest/v1/rpc/unsubscribe_mail",
                                             admin=True, body={"p_token_hash": digest(payload.token)})
        if not consumed:
            raise HTTPException(400, "Ссылка недействительна или срок её действия истёк.")
        return {"message": "Вы отписались от рассылки. Восстановление доступа останется доступно."}
    with connect(request.app.state.settings) as db:
        db.execute("BEGIN IMMEDIATE")
        user_id = consume_token(db, payload.token, "unsubscribe")
        db.execute("UPDATE users SET newsletter_opt_in = 0 WHERE id = ?", (user_id,))
    return {"message": "Вы отписались от рассылки. Письма для восстановления доступа останутся доступны."}
