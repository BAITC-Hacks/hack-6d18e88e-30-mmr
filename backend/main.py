import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

# Support both the existing `cd backend; uvicorn main:app` and package launch.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from backend.api.ai_routes import router as ai_router
from backend.api.auth_routes import router as auth_router
from backend.api.mail_routes import router as mail_router
from backend.config import Settings, load_settings
from backend.database import initialize
from backend.services.mail import mail_worker
from backend.services.security import COOKIE_NAME, current_user
from backend.schemas.auth import UserResponse

logger = logging.getLogger(__name__)

def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        initialize(settings)
        if settings.mail_backend == "file":
            logger.warning("MAIL_BACKEND=file: email is saved as .eml previews; nothing is sent to inboxes. Configure SMTP and request a new email.")
        if not settings.mail_worker_enabled:
            logger.warning("Mail worker is disabled: queued emails require backend.manage send-pending.")
        stop = asyncio.Event()
        mail_enabled = settings.mail_worker_enabled and (settings.auth_provider == "local" or bool(settings.supabase_secret_key))
        worker = asyncio.create_task(mail_worker(settings, stop)) if mail_enabled else None
        yield
        stop.set()
        if worker:
            await worker

    app = FastAPI(title="AI Sana TaskRank API", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        # CORS alone does not prevent CSRF. Cookie-authenticated mutations require a trusted Origin.
        if request.url.path.startswith("/api/") and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if ((origin is not None and origin not in settings.allowed_origins)
                    or (settings.auth_provider == "local" and request.cookies.get(COOKIE_NAME) and origin not in settings.allowed_origins)):
                return JSONResponse({"detail": "Недопустимый Origin запроса."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith(("/api/auth", "/api/mail", "/account")):
            response.headers["Cache-Control"] = "no-store"
        if request.url.path.startswith("/account"):
            response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        return response

    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
                       allow_headers=["Content-Type", "Authorization"])
    app.include_router(ai_router, prefix="/api")
    if settings.auth_provider == "local":
        app.include_router(auth_router, prefix="/api")
    else:
        @app.get("/api/auth/me", response_model=UserResponse, tags=["Accounts"])
        def supabase_me(user=Depends(current_user)):
            return user
    app.include_router(mail_router, prefix="/api")

    @app.get("/api/auth/config", tags=["Accounts"])
    def auth_config():
        return {"provider": settings.auth_provider, "account_url": settings.auth_page_url}

    @app.get("/health")
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "service": "ai-sana-taskrank"}

    @app.get("/account", include_in_schema=False)
    def account_page():
        return FileResponse(Path(__file__).parent / "static/account.html")

    @app.get("/account.js", include_in_schema=False)
    def account_script():
        return FileResponse(Path(__file__).parent / "static/account.js", media_type="text/javascript")

    @app.get("/account.css", include_in_schema=False)
    def account_styles():
        return FileResponse(Path(__file__).parent / "static/account.css", media_type="text/css")

    @app.get("/email-preview/{template}", include_in_schema=False)
    def email_preview(template: Literal["confirmation", "recovery"]):
        # Static samples contain only intentionally invalid demo links, no tokens or addresses.
        path = Path(__file__).resolve().parents[1] / "supabase/email-templates/preview" / f"{template}.html"
        return FileResponse(path, media_type="text/html")

    return app


app = create_app()
