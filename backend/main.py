import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# The core service imports are historical top-level modules; account modules use
# package imports. Support both `--app-dir backend main:app` and `backend.main:app`.
backend_dir = Path(__file__).resolve().parent
for import_root in (backend_dir.parent, backend_dir):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from fastapi import FastAPI
from fastapi.responses import FileResponse

from api.ai_routes import router as ai_router
from backend.api.auth_routes import router as auth_router
from backend.api.mail_routes import router as mail_router
from backend.config import Settings, load_settings
from backend.database import initialize
from backend.services.mail import mail_worker
from backend.settings import Settings as CoreSettings
from request_validation import StrictJSONMiddleware, install_error_handlers
from security import RateLimiter, ScopedCORSMiddleware, SecurityMiddleware


def create_app(settings: CoreSettings | None = None) -> FastAPI:
    if settings is None:
        settings = load_settings()
    elif not isinstance(settings, Settings):
        # Existing core callers can keep passing their security-only dataclass.
        settings = Settings.from_core(settings)
    production = settings.environment == "production"

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        initialize(settings)
        stop = asyncio.Event()
        worker = asyncio.create_task(mail_worker(settings, stop)) if settings.mail_worker_enabled else None
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
    application.state.rate_limiter = limiter
    install_error_handlers(application)
    # New layers are outermost: auth/CSRF/budgets run before CORS and JSON parsing.
    application.add_middleware(StrictJSONMiddleware, max_body_bytes=262144, body_timeout=5.0)
    application.add_middleware(ScopedCORSMiddleware, settings=settings)
    application.add_middleware(SecurityMiddleware, settings=settings, limiter=limiter)
    application.include_router(ai_router, prefix="/api")
    application.include_router(auth_router, prefix="/api")
    application.include_router(mail_router, prefix="/api")

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
