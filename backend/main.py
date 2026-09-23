import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Support both the existing `cd backend; uvicorn main:app` and package launch.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from backend.api.ai_routes import router as ai_router
from backend.api.auth_routes import router as auth_router
from backend.api.mail_routes import router as mail_router
from backend.config import Settings, load_settings
from backend.database import initialize
from backend.services.mail import mail_worker
from backend.services.security import COOKIE_NAME


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        initialize(settings)
        stop = asyncio.Event()
        worker = asyncio.create_task(mail_worker(settings, stop)) if settings.mail_worker_enabled else None
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
                    or (request.cookies.get(COOKIE_NAME) and origin not in settings.allowed_origins)):
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
                       allow_headers=["Content-Type"])
    app.include_router(ai_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(mail_router, prefix="/api")

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

    return app


app = create_app()
