"""Account/mail settings extend the common API security configuration."""

import os
from dataclasses import dataclass, field, fields
from email.utils import getaddresses
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import EmailStr, TypeAdapter, ValidationError

from .settings import Settings as CoreSettings, hostname

ROOT = Path(__file__).resolve().parents[1]


def _load_environment() -> None:
    load_dotenv(ROOT / ".env", override=False)
    load_dotenv(ROOT / "backend" / ".env", override=False)


def _integer(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be a valid integer") from None


def _boolean(name: str, default: bool | None) -> bool | None:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized not in {"true", "false"}:
        raise ValueError(f"{name} must be true or false")
    return normalized == "true"


def _account_environment() -> dict:
    supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
    return {
        "auth_provider": os.getenv("AUTH_PROVIDER") or ("supabase" if supabase_url or supabase_key else "local"),
        "supabase_url": supabase_url,
        "supabase_publishable_key": supabase_key,
        "supabase_secret_key": os.getenv("SUPABASE_SECRET_KEY", "").strip(),
        "database_path": ROOT / os.getenv("DATABASE_PATH", "backend/data/app.sqlite3"),
        "auth_page_url": os.getenv("AUTH_PAGE_URL", "").rstrip("/"),
        "unsubscribe_page_url": os.getenv("UNSUBSCRIBE_PAGE_URL", "").rstrip("/"),
        "cookie_secure": _boolean("COOKIE_SECURE", None),
        "session_hours": _integer("SESSION_HOURS", 24),
        "mail_backend": os.getenv("MAIL_BACKEND", "file"),
        "auth_mail_format": os.getenv("AUTH_MAIL_FORMAT", "html"),
        "mail_directory": ROOT / os.getenv("MAIL_DIRECTORY", "backend/data/mail"),
        "mail_from": os.getenv("MAIL_FROM", "AI Sana <noreply@example.com>"),
        "smtp_host": os.getenv("SMTP_HOST", ""),
        "smtp_port": _integer("SMTP_PORT", 587),
        "smtp_user": os.getenv("SMTP_USER", ""),
        "smtp_password": os.getenv("SMTP_PASSWORD", ""),
        "mail_worker_enabled": _boolean("MAIL_WORKER_ENABLED", True),
    }


def _page_url(name: str, value: str, production: bool) -> str:
    try:
        url = urlsplit(value)
        if (url.scheme not in ({"https"} if production else {"http", "https"})
                or not url.hostname or url.username is not None or url.password is not None
                or url.query or url.fragment or any(ord(char) < 33 for char in value)):
            raise ValueError
        hostname(url.hostname)
        _ = url.port
    except ValueError:
        raise ValueError(f"{name} must be an HTTP(S) URL without credentials, query or fragment; HTTPS is required in production") from None
    return value.rstrip("/")


@dataclass(frozen=True)
class Settings(CoreSettings):
    auth_provider: str = "local"
    supabase_url: str = ""
    supabase_publishable_key: str = field(default="", repr=False)
    supabase_secret_key: str = field(default="", repr=False)
    database_path: Path = ROOT / "backend/data/app.sqlite3"
    auth_page_url: str = ""
    unsubscribe_page_url: str = ""
    cookie_secure: bool | None = None
    session_hours: int = 24
    mail_backend: str = "file"
    auth_mail_format: str = "html"
    mail_directory: Path = ROOT / "backend/data/mail"
    mail_from: str = "AI Sana <noreply@example.com>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = field(default="", repr=False)
    mail_worker_enabled: bool = True

    def __post_init__(self):
        super().__post_init__()
        production = self.environment == "production"
        if self.auth_provider not in {"local", "supabase"}:
            raise ValueError("AUTH_PROVIDER must be local or supabase")
        if self.auth_provider == "supabase":
            try:
                url = urlsplit(self.supabase_url)
                if (url.scheme != "https" or not url.hostname or url.path not in {"", "/"}
                        or url.query or url.fragment or url.username is not None or url.password is not None
                        or any(ord(char) < 33 for char in self.supabase_url)):
                    raise ValueError
                hostname(url.hostname)
                _ = url.port
            except ValueError:
                raise ValueError("SUPABASE_URL must be an HTTPS project origin") from None
            if not self.supabase_publishable_key:
                raise ValueError("SUPABASE_PUBLISHABLE_KEY is required")
            if self.supabase_publishable_key.startswith("sb_secret_"):
                raise ValueError("Use the publishable key, not a secret key, for account requests")
        for name, value in (("SUPABASE_PUBLISHABLE_KEY", self.supabase_publishable_key),
                            ("SUPABASE_SECRET_KEY", self.supabase_secret_key)):
            if value and (len(value) > 16384 or not value.isascii() or any(ord(char) < 33 or ord(char) > 126 for char in value)):
                raise ValueError(f"{name} must be printable ASCII without whitespace and at most 16384 characters")
        object.__setattr__(self, "supabase_url", self.supabase_url.rstrip("/"))
        if self.cookie_secure is not None and type(self.cookie_secure) is not bool:
            raise ValueError("COOKIE_SECURE must be a boolean")
        secure = production if self.cookie_secure is None else self.cookie_secure
        if production and not secure:
            raise ValueError("Production requires COOKIE_SECURE=true")
        object.__setattr__(self, "cookie_secure", secure)
        auth_url = self.auth_page_url or (
            (f"{self.allowed_origins[0]}/auth" if production else "http://localhost:5173/auth") if self.auth_provider == "supabase"
            else (f"{self.allowed_origins[0]}/auth" if production else "http://localhost:5173")
        )
        object.__setattr__(self, "auth_page_url", _page_url("AUTH_PAGE_URL", auth_url, production))
        unsubscribe_url = self.unsubscribe_page_url or (
            f"{self.allowed_origins[0]}/account" if production else "http://localhost:8000/account"
        )
        object.__setattr__(self, "unsubscribe_page_url", _page_url("UNSUBSCRIBE_PAGE_URL", unsubscribe_url, production))
        object.__setattr__(self, "database_path", Path(self.database_path))
        object.__setattr__(self, "mail_directory", Path(self.mail_directory))
        if self.mail_backend not in {"file", "smtp"}:
            raise ValueError("MAIL_BACKEND must be file or smtp")
        if self.auth_mail_format not in {"html", "text"}:
            raise ValueError("AUTH_MAIL_FORMAT must be html or text")
        if self.mail_backend == "smtp" and not self.smtp_host:
            raise ValueError("SMTP_HOST is required for SMTP delivery")
        if bool(self.smtp_user) != bool(self.smtp_password):
            raise ValueError("Set both SMTP_USER and SMTP_PASSWORD")
        if type(self.session_hours) is not int or not 1 <= self.session_hours <= 8760:
            raise ValueError("SESSION_HOURS must be an integer between 1 and 8760")
        if type(self.smtp_port) is not int or not 1 <= self.smtp_port <= 65535:
            raise ValueError("SMTP_PORT must be an integer between 1 and 65535")
        if type(self.mail_worker_enabled) is not bool:
            raise ValueError("MAIL_WORKER_ENABLED must be a boolean")
        if any(char in self.mail_from for char in "\r\n"):
            raise ValueError("MAIL_FROM must not contain line breaks")
        if self.mail_backend == "smtp":
            try:
                addresses = getaddresses([self.mail_from])
                if len(addresses) != 1:
                    raise ValueError()
                sender = TypeAdapter(EmailStr).validate_python(addresses[0][1])
                if sender.lower() == "noreply@example.com":
                    raise ValueError()
            except (ValueError, ValidationError):
                raise ValueError("MAIL_FROM must contain one real sender email address, not the example placeholder") from None
            if self.smtp_host.lower() == "smtp.gmail.com" and not (self.smtp_user and self.smtp_password):
                raise ValueError("Gmail requires SMTP_USER and SMTP_PASSWORD (an app password)")

    @classmethod
    def from_core(cls, settings: CoreSettings):
        """Preserve explicit security settings while honoring account paths from env."""
        _load_environment()
        core = {item.name: getattr(settings, item.name) for item in fields(CoreSettings)}
        return cls(**core, **_account_environment())

    @classmethod
    def from_env(cls):
        _load_environment()
        core = CoreSettings.from_env()
        # Retain the accounts branch's legacy CORS_ORIGINS setting as an alias;
        # the validated API_ALLOWED_ORIGINS configuration always takes precedence.
        values = {item.name: getattr(core, item.name) for item in fields(CoreSettings)}
        if "API_ALLOWED_ORIGINS" not in os.environ and "CORS_ORIGINS" in os.environ:
            values["allowed_origins"] = tuple(
                item.strip().rstrip("/") for item in os.environ["CORS_ORIGINS"].split(",") if item.strip()
            )
        return cls(**values, **_account_environment())


def load_settings() -> Settings:
    return Settings.from_env()
