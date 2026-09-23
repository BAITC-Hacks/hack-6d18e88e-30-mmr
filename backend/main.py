from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.ai_routes import router as ai_router
from request_validation import StrictJSONMiddleware, install_error_handlers
from security import RateLimiter, SecurityMiddleware
from settings import Settings

backend_dir = Path(__file__).resolve().parent
# Environment variables win; support launch from either the repository or backend/.
load_dotenv(backend_dir / ".env", override=False)
load_dotenv(backend_dir.parent / ".env", override=False)

def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    production = settings.environment == "production"
    application = FastAPI(
        title="AI Sana TaskRank API",
        version="0.1.0",
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
    # add_middleware inserts each new layer outermost: authenticate and budget
    # requests before body reading, JSON parsing or paid provider operations.
    application.add_middleware(StrictJSONMiddleware, max_body_bytes=262144, body_timeout=5.0)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )
    application.add_middleware(SecurityMiddleware, settings=settings, limiter=limiter)
    application.include_router(ai_router, prefix="/api")

    @application.get("/health")
    async def health():
        return {"status": "ok", "service": "ai-sana-taskrank"}

    return application


app = create_app()
