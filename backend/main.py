"""AI endpoints and account endpoints share deployment guards, not credentials."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

backend_dir = Path(__file__).resolve().parent
# Keep both `uvicorn main:app` from backend/ and `uvicorn backend.main:app`
# working; core tests monkeypatch these existing top-level service modules.
for import_path in (backend_dir.parent, backend_dir):
    if str(import_path) not in sys.path:
        sys.path.insert(0, str(import_path))

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette._utils import get_route_path
from starlette.datastructures import MutableHeaders
from starlette.routing import compile_path

from api.ai_routes import router as ai_router
from backend.api.auth_routes import router as auth_router
from backend.api.mail_routes import router as mail_router
from backend.config import Settings as AccountSettings, load_settings
from backend.database import initialize
from backend.services.mail import mail_worker
from backend.services.security import COOKIE_NAME
from request_validation import StrictJSONMiddleware, install_error_handlers
from security import RateLimiter, SecurityMiddleware
from settings import Settings as ApiSettings

load_dotenv(backend_dir / ".env", override=False)
load_dotenv(backend_dir.parent / ".env", override=False)


class AccountHeadersMiddleware:
    def __init__(self, app, allowed_origins):
        self.app = app
        self.allowed_origins = allowed_origins

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

        if path.startswith("/api/") and scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
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
                                       allow_methods=["GET", "POST", "PATCH", "OPTIONS"], allow_headers=["Content-Type"])
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
        stop = asyncio.Event()
        worker = asyncio.create_task(mail_worker(accounts, stop)) if accounts.mail_worker_enabled else None
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
    application.include_router(auth_router, prefix="/api")
    application.include_router(mail_router, prefix="/api")
    account_routes = tuple((compile_path("/api" + route.path)[0], frozenset(route.methods))
                           for router in (auth_router, mail_router) for route in router.routes)
    # Only registered account/mail methods use their cookie/token/admin checks.
    # Other /api routes, including unknown or suffixed paths, keep bearer auth.
    application.add_middleware(StrictJSONMiddleware, max_body_bytes=262144, body_timeout=5.0,
                               optional_empty_paths=frozenset({"/api/auth/logout"}))
    application.add_middleware(AccountHeadersMiddleware, allowed_origins=api_settings.allowed_origins)
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

    return application


app = create_app()
