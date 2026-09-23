import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from dataclasses import fields, replace
from pathlib import Path
from typing import Literal

# The core service imports are historical top-level modules; account modules use
# package imports. Support both `--app-dir backend main:app` and `backend.main:app`.
backend_dir = Path(__file__).resolve().parent
for import_root in (backend_dir.parent, backend_dir):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse, HTMLResponse

from api.ai_routes import router as ai_router
from backend.api.auth_routes import router as auth_router
from backend.api.mail_routes import router as mail_router
from backend.config import Settings, load_settings
from backend.database import initialize
from backend.services.mail import mail_worker
from backend.services.security import current_user
from backend.schemas.auth import UserResponse
from backend.settings import Settings as CoreSettings
from request_validation import StrictJSONMiddleware, install_error_handlers
from security import RateLimiter, ScopedCORSMiddleware, SecurityMiddleware

logger = logging.getLogger(__name__)


def create_app(settings: CoreSettings | Settings | None = None, *, account_settings: Settings | None = None) -> FastAPI:
    if account_settings is not None:
        # Preserve callers that pass isolated account storage alongside core guards.
        core = {item.name: getattr(settings, item.name) for item in fields(CoreSettings)} if settings is not None else {}
        settings = replace(account_settings, **core)
    elif settings is None:
        settings = load_settings()
    elif not isinstance(settings, Settings):
        # Existing core callers can keep passing their security-only dataclass.
        settings = Settings.from_core(settings)
    production = settings.environment == "production"

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        initialize(settings)
        if settings.mail_backend == "file":
            logger.warning("MAIL_BACKEND=file: email is saved as .eml previews; nothing is sent to inboxes. Configure SMTP and request a new email.")
        if not settings.mail_worker_enabled:
            logger.warning("Mail worker is disabled: queued emails require backend.manage send-pending.")
        stop = asyncio.Event()
        mail_enabled = settings.mail_worker_enabled and (
            settings.auth_provider == "local" or bool(settings.supabase_secret_key)
        )
        worker = asyncio.create_task(mail_worker(settings, stop)) if mail_enabled else None
        try:
            yield
        finally:
            stop.set()
            if worker is not None:
                await worker

    application = FastAPI(
        title="AI Sana TaskRank API",
        version="0.2.0",
        lifespan=lifespan,
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    limiter = RateLimiter(
        per_client=settings.rate_limit_per_client,
        global_limit=settings.rate_limit_global,
        window_seconds=settings.rate_limit_window_seconds,
    )
    application.state.settings = settings
    application.state.api_settings = settings
    application.state.rate_limiter = limiter
    install_error_handlers(application)
    # New layers are outermost: auth/CSRF/budgets run before CORS and JSON parsing.
    application.add_middleware(StrictJSONMiddleware, max_body_bytes=262144, body_timeout=5.0)
    application.add_middleware(ScopedCORSMiddleware, settings=settings)
    application.add_middleware(SecurityMiddleware, settings=settings, limiter=limiter)
    application.include_router(ai_router, prefix="/api")
    if settings.auth_provider == "local":
        application.include_router(auth_router, prefix="/api")
    else:
        @application.get("/api/auth/me", response_model=UserResponse, tags=["Accounts"])
        def supabase_me(user=Depends(current_user)):
            return user
    application.include_router(mail_router, prefix="/api")

    @application.get("/api/auth/config", tags=["Accounts"])
    def auth_config():
        return {"provider": settings.auth_provider, "account_url": settings.auth_page_url}

    @application.get("/health")
    @application.get("/api/health")
    async def health():
        return {"status": "ok", "service": "ai-sana-taskrank"}

    @application.get("/account", include_in_schema=False)
    def account_page():
        return FileResponse(backend_dir / "static/account.html")

    @application.get("/account.js", include_in_schema=False)
    def account_script():
        return FileResponse(backend_dir / "static/account.js", media_type="text/javascript")

    @application.get("/account.css", include_in_schema=False)
    def account_styles():
        return FileResponse(backend_dir / "static/account.css", media_type="text/css")

    @application.get("/email-preview/{template}", include_in_schema=False)
    def email_preview(template: Literal["confirmation", "recovery"]):
        if settings.auth_provider == "local":
            from backend.services.email_templates import action_email
            recovery = template == "recovery"
            html = action_email(
                "Вернём вас к вашим проектам" if recovery else "Добро пожаловать в AI Sana",
                "Получили запрос на смену пароля вашего аккаунта. Нажмите кнопку ниже, чтобы задать новый пароль."
                if recovery else "Остался один шаг: подтвердите почту, чтобы начать работу с бизнес-задачами и командами.",
                f"https://example.invalid/#{'reset' if recovery else 'verify'}=DEMO-NOT-A-REAL-TOKEN",
                "Задать новый пароль" if recovery else "Подтвердить почту",
                30 if recovery else 1440,
            )
            return HTMLResponse(html, headers={"Cache-Control": "no-store"})
        # These static samples contain intentionally invalid demo links, never tokens.
        path = backend_dir.parent / "supabase/email-templates/preview" / f"{template}.html"
        return FileResponse(path, media_type="text/html")

    return application


app = create_app()
