"""AI endpoints and account endpoints share deployment guards, not credentials."""
import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from dataclasses import replace
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

backend_dir = Path(__file__).resolve().parent
# Keep both `uvicorn main:app` from backend/ and `uvicorn backend.main:app`
# working; core tests monkeypatch these existing top-level service modules.
for import_path in (backend_dir.parent, backend_dir):
    if str(import_path) not in sys.path:
        sys.path.insert(0, str(import_path))

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette._utils import get_route_path
from starlette.datastructures import MutableHeaders
from starlette.routing import compile_path

from api.ai_routes import router as ai_router
from backend.api.auth_routes import router as auth_router
from backend.api.mail_routes import router as mail_router
from backend.config import Settings as AccountSettings, load_settings
from backend.database import initialize
from backend.services.mail import mail_worker
from backend.services.security import COOKIE_NAME, current_user
from backend.schemas.auth import UserResponse
from request_validation import StrictJSONMiddleware, install_error_handlers
from security import RateLimiter, SecurityMiddleware
from settings import Settings as ApiSettings

# Keep the existing root .env authoritative; backend/.env is an AI fallback.
load_dotenv(backend_dir.parent / ".env", override=False)
load_dotenv(backend_dir / ".env", override=False)

logger = logging.getLogger(__name__)

class AccountHeadersMiddleware:
    def __init__(self, app, allowed_origins, local_auth):
        self.app = app
        self.allowed_origins = allowed_origins
        self.local_auth = local_auth

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = get_route_path(scope)

        async def safe_send(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Referrer-Policy"] = "no-referrer"
                if path.startswith("/account"):
                    headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
            await send(message)

        if self.local_auth and path.startswith("/api/") and scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
            request = Request(scope)
            if request.cookies.get(COOKIE_NAME) and request.headers.get("origin") not in self.allowed_origins:
                response = JSONResponse({"detail": "Недопустимый Origin запроса."}, status_code=403)
                await response(scope, receive, safe_send)
                return
        await self.app(scope, receive, safe_send)


class RouteCORSMiddleware:
    def __init__(self, app, allowed_origins, account_routes):
        self.account_routes = account_routes
        self.accounts = CORSMiddleware(app, allow_origins=list(allowed_origins), allow_credentials=True,
                                       allow_methods=["GET", "POST", "PATCH", "OPTIONS"], allow_headers=["Content-Type", "Authorization"])
        self.core = CORSMiddleware(app, allow_origins=list(allowed_origins), allow_credentials=False,
                                   allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "Authorization"])

    async def __call__(self, scope, receive, send):
        is_account = scope["type"] == "http" and any(pattern.fullmatch(get_route_path(scope)) for pattern, _methods in self.account_routes)
        await (self.accounts if is_account else self.core)(scope, receive, send)


def create_app(settings: ApiSettings | AccountSettings | None = None, *, account_settings: AccountSettings | None = None) -> FastAPI:
    # Preserve both branches' explicit test/application factory contracts.
    explicit_accounts = settings if isinstance(settings, AccountSettings) else account_settings
    api_settings = ApiSettings.from_env() if settings is None or isinstance(settings, AccountSettings) else settings
    accounts = explicit_accounts or load_settings()
    if explicit_accounts is None and "CORS_ORIGINS" not in os.environ:
        accounts = replace(accounts, allowed_origins=api_settings.allowed_origins)
    origins = tuple(dict.fromkeys((*api_settings.allowed_origins, *accounts.allowed_origins)))
    hosts = api_settings.allowed_hosts
    if isinstance(settings, AccountSettings) and api_settings.environment == "development" and "API_ALLOWED_HOSTS" not in os.environ:
        hosts = tuple(dict.fromkeys((*hosts, *(urlsplit(origin).hostname for origin in accounts.allowed_origins))))
    api_settings = replace(api_settings, allowed_origins=origins, allowed_hosts=hosts)
    production = api_settings.environment == "production"
    if production and not accounts.cookie_secure:
        accounts = replace(accounts, cookie_secure=True)

    @asynccontextmanager
    async def lifespan(_application: FastAPI):
        initialize(accounts)
        if accounts.mail_backend == "file":
            logger.warning("MAIL_BACKEND=file: email is saved as .eml previews; nothing is sent to inboxes. Configure SMTP and request a new email.")
        if not accounts.mail_worker_enabled:
            logger.warning("Mail worker is disabled: queued emails require backend.manage send-pending.")
        stop = asyncio.Event()
        mail_enabled = accounts.mail_worker_enabled and (accounts.auth_provider == "local" or bool(accounts.supabase_secret_key))
        worker = asyncio.create_task(mail_worker(accounts, stop)) if mail_enabled else None
        try:
            yield
        finally:
            stop.set()
            if worker:
                await worker

    application = FastAPI(title="AI Sana TaskRank API", version="0.2.0", lifespan=lifespan,
                          docs_url=None if production else "/docs", redoc_url=None if production else "/redoc",
                          openapi_url=None if production else "/openapi.json")
    application.state.settings = accounts
    application.state.api_settings = api_settings
    limiter = RateLimiter(per_client=api_settings.rate_limit_per_client, global_limit=api_settings.rate_limit_global,
                          window_seconds=api_settings.rate_limit_window_seconds)
    application.state.rate_limiter = limiter
    install_error_handlers(application)
    application.include_router(ai_router, prefix="/api")
    account_router = APIRouter()
    account_route_sources = [account_router, mail_router]
    if accounts.auth_provider == "local":
        application.include_router(auth_router, prefix="/api")
        account_route_sources.append(auth_router)
    else:
        @account_router.get("/auth/me", response_model=UserResponse, tags=["Accounts"])
        def supabase_me(user=Depends(current_user)):
            return user
    application.include_router(mail_router, prefix="/api")

    @account_router.get("/auth/config", tags=["Accounts"])
    def auth_config():
        return {"provider": accounts.auth_provider, "account_url": accounts.auth_page_url}

    application.include_router(account_router, prefix="/api")
    account_routes = tuple((compile_path("/api" + route.path)[0], frozenset(route.methods))
                           for router in account_route_sources for route in router.routes)
    # Only registered account/mail methods use their cookie/token/admin checks.
    # Other /api routes, including unknown or suffixed paths, keep bearer auth.
    application.add_middleware(StrictJSONMiddleware, max_body_bytes=262144, body_timeout=5.0,
                               optional_empty_paths=frozenset({"/api/auth/logout"}))
    application.add_middleware(AccountHeadersMiddleware, allowed_origins=api_settings.allowed_origins,
                               local_auth=accounts.auth_provider == "local")
    application.add_middleware(RouteCORSMiddleware, allowed_origins=api_settings.allowed_origins, account_routes=account_routes)
    application.add_middleware(SecurityMiddleware, settings=api_settings, limiter=limiter, bearer_exempt_routes=account_routes)

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
        # Render the same local template as SMTP; samples never contain real tokens.
        if accounts.auth_provider == "local":
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
        # Supabase samples preserve its separate URL format.
        path = Path(__file__).resolve().parents[1] / "supabase/email-templates/preview" / f"{template}.html"
        return FileResponse(path, media_type="text/html")

    return application


app = create_app()
