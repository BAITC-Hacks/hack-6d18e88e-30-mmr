"""Small, validated deployment settings; no secret is shipped to the browser."""

from dataclasses import dataclass, field
from ipaddress import ip_address
import os
import re
from urllib.parse import urlsplit


def hostname(value: str) -> str:
    """Accept exact IP addresses or DNS names, never wildcards, ports or URLs."""
    try:
        return str(ip_address(value))
    except ValueError:
        if len(value) > 253 or not re.fullmatch(
            r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*",
            value,
        ):
            raise ValueError("API_ALLOWED_HOSTS must contain exact hostnames or IP addresses") from None
        return value.lower()


def origin(value: str, production: bool) -> str:
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in ({"https"} if production else {"http", "https"})
                or not parsed.hostname or parsed.username is not None or parsed.password is not None
                or parsed.path or parsed.query or parsed.fragment or value != f"{parsed.scheme}://{parsed.netloc}"):
            raise ValueError
        hostname(parsed.hostname)
        _ = parsed.port  # Reject invalid and out-of-range ports.
    except ValueError:
        raise ValueError("API_ALLOWED_ORIGINS must contain exact origins (HTTPS in production), without credentials or paths") from None
    return value


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    api_access_token: str = field(default="", repr=False)
    allowed_hosts: tuple[str, ...] | None = None
    allowed_origins: tuple[str, ...] | None = None
    rate_limit_per_client: int = 60
    rate_limit_global: int = 300
    rate_limit_window_seconds: int = 60

    def __post_init__(self):
        if self.environment not in {"development", "production"}:
            raise ValueError("APP_ENV must be development or production")
        production = self.environment == "production"
        token = self.api_access_token
        if token and (not 32 <= len(token) <= 256 or not token.isascii()
                      or any(ord(char) < 33 or ord(char) > 126 for char in token)):
            raise ValueError("API_ACCESS_TOKEN must be 32-256 printable ASCII characters without whitespace")
        if production and (not token or not self.allowed_hosts or not self.allowed_origins):
            raise ValueError("Production requires API_ACCESS_TOKEN, API_ALLOWED_HOSTS and API_ALLOWED_ORIGINS")
        hosts = self.allowed_hosts if self.allowed_hosts is not None else ("localhost", "127.0.0.1", "::1", "testserver")
        origins = self.allowed_origins if self.allowed_origins is not None else (
            "http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:4173", "http://127.0.0.1:4173",
            "http://localhost:8000", "http://127.0.0.1:8000",
        )
        if not hosts:
            raise ValueError("API_ALLOWED_HOSTS cannot be empty")
        object.__setattr__(self, "allowed_hosts", tuple(hostname(host) for host in hosts))
        object.__setattr__(self, "allowed_origins", tuple(origin(item, production) for item in origins))
        for name, limit, maximum in (
            ("API_RATE_LIMIT_PER_CLIENT", self.rate_limit_per_client, 10_000),
            ("API_RATE_LIMIT_GLOBAL", self.rate_limit_global, 100_000),
            ("API_RATE_LIMIT_WINDOW_SECONDS", self.rate_limit_window_seconds, 3_600),
        ):
            if type(limit) is not int or not 1 <= limit <= maximum:
                raise ValueError(f"{name} must be an integer between 1 and {maximum}")

    @classmethod
    def from_env(cls):
        def csv(name):
            value = os.getenv(name)
            return tuple(item.strip() for item in value.split(",") if item.strip()) if value is not None else None

        def integer(name, default):
            try:
                return int(os.getenv(name, str(default)))
            except ValueError:
                # A misplaced credential in an environment variable must not be
                # copied into startup logs by Python's int() error message.
                raise ValueError(f"{name} must be a valid integer") from None

        return cls(
            environment=os.getenv("APP_ENV", "development"),
            api_access_token=os.getenv("API_ACCESS_TOKEN", ""),
            allowed_hosts=csv("API_ALLOWED_HOSTS"),
            allowed_origins=csv("API_ALLOWED_ORIGINS"),
            rate_limit_per_client=integer("API_RATE_LIMIT_PER_CLIENT", 60),
            rate_limit_global=integer("API_RATE_LIMIT_GLOBAL", 300),
            rate_limit_window_seconds=integer("API_RATE_LIMIT_WINDOW_SECONDS", 60),
        )
