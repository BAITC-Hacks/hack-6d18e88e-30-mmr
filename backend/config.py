import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    database_path: Path = ROOT / "backend/data/app.sqlite3"
    auth_page_url: str = "http://localhost:8000/account"
    allowed_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000")
    cookie_secure: bool = False
    session_hours: int = 24
    mail_backend: str = "file"
    mail_directory: Path = ROOT / "backend/data/mail"
    mail_from: str = "AI Sana <noreply@example.com>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_worker_enabled: bool = True

    def __post_init__(self):
        if self.mail_backend not in {"file", "smtp"}:
            raise ValueError("MAIL_BACKEND must be file or smtp")
        url = urlsplit(self.auth_page_url)
        if url.scheme not in {"http", "https"} or not url.netloc or url.query or url.fragment:
            raise ValueError("AUTH_PAGE_URL must be an http(s) URL without query or fragment")
        if self.mail_backend == "smtp" and not self.smtp_host:
            raise ValueError("SMTP_HOST is required for SMTP delivery")
        if bool(self.smtp_user) != bool(self.smtp_password):
            raise ValueError("Set both SMTP_USER and SMTP_PASSWORD")
        if self.session_hours < 1:
            raise ValueError("SESSION_HOURS must be positive")


def load_settings() -> Settings:
    load_dotenv(ROOT / ".env")
    return Settings(
        database_path=ROOT / os.getenv("DATABASE_PATH", "backend/data/app.sqlite3"),
        auth_page_url=os.getenv("AUTH_PAGE_URL", "http://localhost:8000/account").rstrip("/"),
        allowed_origins=tuple(x.strip().rstrip("/") for x in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"
        ).split(",") if x.strip()),
        cookie_secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        session_hours=int(os.getenv("SESSION_HOURS", "24")),
        mail_backend=os.getenv("MAIL_BACKEND", "file"),
        mail_directory=ROOT / os.getenv("MAIL_DIRECTORY", "backend/data/mail"),
        mail_from=os.getenv("MAIL_FROM", "AI Sana <noreply@example.com>"),
        smtp_host=os.getenv("SMTP_HOST", ""),
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        smtp_user=os.getenv("SMTP_USER", ""),
        smtp_password=os.getenv("SMTP_PASSWORD", ""),
        mail_worker_enabled=os.getenv("MAIL_WORKER_ENABLED", "true").lower() == "true",
    )
