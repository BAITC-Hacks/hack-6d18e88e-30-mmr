"""Authentication and bounded in-process request budgets for the local/demo API."""

from ipaddress import ip_address
import math
import secrets
from threading import Lock
import time
from urllib.parse import urlsplit

from starlette._utils import get_route_path
from starlette.datastructures import MutableHeaders
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from settings import Settings, hostname


def is_account_api(path: str) -> bool:
    return any(path == prefix or path.startswith(prefix + '/') for prefix in ('/api/auth', '/api/mail'))


class ScopedCORSMiddleware:
    """Only account routes use browser cookies; AI remains a bearer-only API."""

    def __init__(self, app: ASGIApp, settings: Settings):
        common = {'allow_origins': list(settings.allowed_origins),
                  'allow_headers': ['Content-Type', 'Authorization']}
        self.accounts = CORSMiddleware(app, allow_credentials=True,
                                       allow_methods=['GET', 'POST', 'PATCH', 'OPTIONS'], **common)
        self.other = CORSMiddleware(app, allow_credentials=False,
                                    allow_methods=['GET', 'POST', 'OPTIONS'], **common)

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        app = self.accounts if scope['type'] == 'http' and is_account_api(get_route_path(scope)) else self.other
        await app(scope, receive, send)


class RateLimiter:
    """Fixed-window budgets, scoped to one process. Shared deployments need a gateway budget."""

    def __init__(self, per_client=60, global_limit=300, window_seconds=60, max_clients=1024, clock=time.monotonic):
        if any(type(value) is not int or value < 1 for value in (per_client, global_limit, window_seconds, max_clients)):
            raise ValueError("Rate limits must be positive integers")
        self.per_client = per_client
        self.global_limit = global_limit
        self.window_seconds = window_seconds
        self.max_clients = max_clients
        self._clock = clock
        self._lock = Lock()
        self._clients: dict[str, int] = {}
        self._total = 0
        self._started = clock()

    @property
    def client_count(self):
        with self._lock:
            return len(self._clients)

    def reset(self):
        with self._lock:
            self._clients.clear()
            self._total = 0
            self._started = self._clock()

    def check(self, client: str) -> int:
        """Return 0 when accepted, otherwise whole seconds until retry is possible."""
        with self._lock:
            now = self._clock()
            if now - self._started >= self.window_seconds:
                self._clients.clear()
                self._total = 0
                self._started = now
            count = self._clients.get(client, 0)
            if (self._total >= self.global_limit or count >= self.per_client
                    or (client not in self._clients and len(self._clients) >= self.max_clients)):
                return max(1, math.ceil(self.window_seconds - (now - self._started)))
            self._clients[client] = count + 1
            self._total += 1
            return 0


def _local_client(address: str) -> bool:
    if address == "testclient":  # Starlette's in-process test transport, never a network IP.
        return True
    try:
        return ip_address(address).is_loopback
    except ValueError:
        return False


def _request_host(values: list[bytes]) -> str | None:
    if len(values) != 1:
        return None
    try:
        value = values[0].decode("ascii")
        parsed = urlsplit("//" + value)
        if (not parsed.hostname or parsed.username is not None or parsed.password is not None
                or parsed.path or parsed.query or parsed.fragment or parsed.netloc != value):
            return None
        _ = parsed.port
        return hostname(parsed.hostname)
    except (ValueError, UnicodeDecodeError):
        return None


class SecurityMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings, limiter: RateLimiter):
        self.app = app
        self.settings = settings
        self.limiter = limiter

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = get_route_path(scope)

        async def safe_send(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "no-store"
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "no-referrer"
                if path in {'/account', '/account.js', '/account.css'}:
                    headers['Content-Security-Policy'] = (
                        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
                        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
                    )
            await send(message)

        async def reject(status, code, message, headers=None):
            error_headers = dict(headers or {})
            # This layer runs outside CORS. Keep legitimate browser clients able
            # to read 401/429 instead of turning them into opaque network errors.
            request_origins = [value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"origin"]
            if len(request_origins) == 1 and request_origins[0] in self.settings.allowed_origins:
                error_headers["Access-Control-Allow-Origin"] = request_origins[0]
                error_headers["Vary"] = "Origin"
                if is_account_api(path):
                    error_headers['Access-Control-Allow-Credentials'] = 'true'
            response = JSONResponse({"detail": {"code": code, "message": message}}, status_code=status, headers=error_headers)
            await response(scope, receive, safe_send)

        headers = scope.get("headers", [])
        host = _request_host([value for key, value in headers if key.lower() == b"host"])
        if host not in self.settings.allowed_hosts:
            await reject(400, "INVALID_HOST", "Request host is not allowed.")
            return
        # Never read X-Forwarded-For. Start uvicorn with --no-proxy-headers unless a
        # trusted gateway is explicitly configured at the ASGI server boundary.
        client = (scope.get("client") or ("unknown", 0))[0]
        if self.settings.environment == "development" and not _local_client(client):
            await reject(403, "LOCAL_ACCESS_ONLY", "Development API accepts local clients only.")
            return

        origins = [value.decode("latin-1") for key, value in headers if key.lower() == b"origin"]
        if origins and (len(origins) != 1 or origins[0] not in self.settings.allowed_origins):
            await reject(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.")
            return

        # Use the router's own root_path handling, including mounted/gateway URLs.
        is_api = path == "/api" or path.startswith("/api/")
        mutating = scope['method'] in {'POST', 'PATCH', 'PUT', 'DELETE'}
        if is_api and mutating and Request(scope).cookies.get('ai_sana_session') and not origins:
            await reject(403, 'CSRF_ORIGIN_REQUIRED', 'Cookie-authenticated changes require a trusted Origin.')
            return
        is_docs = self.settings.environment != "production" and path.rstrip("/") in {
            "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect",
        }
        preflight = (scope["method"] == "OPTIONS" and bool(origins)
                     and any(key.lower() == b"access-control-request-method" for key, _ in headers))
        if self.settings.api_access_token and (is_api or is_docs) and not preflight:
            authorizations = [value for key, value in headers if key.lower() == b"authorization"]
            parts = authorizations[0].split(b" ") if len(authorizations) == 1 else []
            valid = (len(parts) == 2 and parts[0].lower() == b"bearer"
                     and secrets.compare_digest(parts[1], self.settings.api_access_token.encode("ascii")))
            if not valid:
                await reject(401, "UNAUTHORIZED", "A valid bearer token is required.", {"WWW-Authenticate": "Bearer"})
                return

        if is_api and mutating:
            retry_after = self.limiter.check(client)
            if retry_after:
                await reject(429, "RATE_LIMITED", "Request budget exceeded. Try again later.", {"Retry-After": str(retry_after)})
                return
        await self.app(scope, receive, safe_send)
