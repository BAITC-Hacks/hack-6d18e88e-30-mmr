import os
from dataclasses import dataclass
from email.utils import getaddresses
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import EmailStr, TypeAdapter, ValidationError

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    auth_provider: str = "local"
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    database_path: Path = ROOT / "backend/data/app.sqlite3"
    auth_page_url: str = "http://localhost:5173"
    unsubscribe_page_url: str = "http://localhost:8000/account"
    allowed_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000")
    cookie_secure: bool = False
    session_hours: int = 24
    mail_backend: str = "file"
    auth_mail_format: str = "html"
    mail_directory: Path = ROOT / "backend/data/mail"
    mail_from: str = "AI Sana <noreply@example.com>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_worker_enabled: bool = True

    def __post_init__(self):
        if self.auth_provider not in {"local", "supabase"}:
            raise ValueError("AUTH_PROVIDER must be local or supabase")
        if self.auth_provider == "supabase":
            supabase_url = urlsplit(self.supabase_url)
            if (supabase_url.scheme != "https" or not supabase_url.netloc
                    or supabase_url.path not in {"", "/"} or supabase_url.query or supabase_url.fragment
                    or supabase_url.username or supabase_url.password):
                raise ValueError("SUPABASE_URL must be an HTTPS project origin")
            if not self.supabase_publishable_key:
                raise ValueError("SUPABASE_PUBLISHABLE_KEY is required")
            if self.supabase_publishable_key.startswith("sb_secret_"):
                raise ValueError("Use the publishable key, not a secret key, for account requests")
        if self.mail_backend not in {"file", "smtp"}:
            raise ValueError("MAIL_BACKEND must be file or smtp")
        if self.auth_mail_format not in {"html", "text"}:
            raise ValueError("AUTH_MAIL_FORMAT must be html or text")
        url = urlsplit(self.auth_page_url)
        if url.scheme not in {"http", "https"} or not url.netloc or url.query or url.fragment:
            raise ValueError("AUTH_PAGE_URL must be an http(s) URL without query or fragment")
        unsubscribe_url = urlsplit(self.unsubscribe_page_url)
        if unsubscribe_url.scheme not in {"http", "https"} or not unsubscribe_url.netloc or unsubscribe_url.query or unsubscribe_url.fragment:
            raise ValueError("UNSUBSCRIBE_PAGE_URL must be an http(s) URL without query or fragment")
        if self.mail_backend == "smtp" and not self.smtp_host:
            raise ValueError("SMTP_HOST is required for SMTP delivery")
        if not 1 <= self.smtp_port <= 65535:
            raise ValueError("SMTP_PORT must be between 1 and 65535")
        if self.mail_backend == "smtp":
            try:
                addresses = getaddresses([self.mail_from])
                if len(addresses) != 1 or "\r" in self.mail_from or "\n" in self.mail_from:
                    raise ValueError()
                sender = TypeAdapter(EmailStr).validate_python(addresses[0][1])
                if sender.lower() == "noreply@example.com":
                    raise ValueError()
            except (ValueError, ValidationError):
                raise ValueError("MAIL_FROM must contain one real sender email address, not the example placeholder") from None
            if self.smtp_host.lower() == "smtp.gmail.com" and not (self.smtp_user and self.smtp_password):
                raise ValueError("Gmail requires SMTP_USER and SMTP_PASSWORD (an app password)")
        if bool(self.smtp_user) != bool(self.smtp_password):
            raise ValueError("Set both SMTP_USER and SMTP_PASSWORD")
        if self.session_hours < 1:
            raise ValueError("SESSION_HOURS must be positive")


def load_settings() -> Settings:
    load_dotenv(ROOT / ".env")
    supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
    return Settings(
        auth_provider=os.getenv("AUTH_PROVIDER") or ("supabase" if supabase_url or supabase_key else "local"),
        supabase_url=supabase_url,
        supabase_publishable_key=supabase_key,
        supabase_secret_key=os.getenv("SUPABASE_SECRET_KEY", "").strip(),
        database_path=ROOT / os.getenv("DATABASE_PATH", "backend/data/app.sqlite3"),
        auth_page_url=os.getenv("AUTH_PAGE_URL", "http://localhost:5173").rstrip("/"),
        unsubscribe_page_url=os.getenv("UNSUBSCRIBE_PAGE_URL", "http://localhost:8000/account").rstrip("/"),
        allowed_origins=tuple(x.strip().rstrip("/") for x in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"
        ).split(",") if x.strip()),
        cookie_secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        session_hours=int(os.getenv("SESSION_HOURS", "24")),
        mail_backend=os.getenv("MAIL_BACKEND", "file"),
        auth_mail_format=os.getenv("AUTH_MAIL_FORMAT", "html"),
        mail_directory=ROOT / os.getenv("MAIL_DIRECTORY", "backend/data/mail"),
        mail_from=os.getenv("MAIL_FROM", "AI Sana <noreply@example.com>"),
        smtp_host=os.getenv("SMTP_HOST", ""),
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        smtp_user=os.getenv("SMTP_USER", ""),
        smtp_password=os.getenv("SMTP_PASSWORD", ""),
        mail_worker_enabled=os.getenv("MAIL_WORKER_ENABLED", "true").lower() == "true",
    )
