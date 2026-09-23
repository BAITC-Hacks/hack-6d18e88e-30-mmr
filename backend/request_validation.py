"""Bound and validate JSON before FastAPI parses it; never reflect request bodies."""
import asyncio
import json
import logging
import math

from fastapi.exceptions import RequestValidationError
from starlette._utils import get_route_path
from starlette.responses import JSONResponse

logger = logging.getLogger('ai_sana.requests')
MAX_JSON_DEPTH = 32
MAX_JSON_NODES = 10000


def _strict_json(body: bytes) -> None:
    text = body.decode('utf-8')
    depth = 0
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in '[{':
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise ValueError('JSON depth limit')
        elif char in ']}':
            depth -= 1

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result

    def reject_constant(_value):
        raise ValueError('Non-finite JSON value')

    def finite_float(value):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError('Non-finite JSON value')
        return result

    parsed = json.loads(text, object_pairs_hook=unique_object,
                        parse_constant=reject_constant, parse_float=finite_float)
    if not isinstance(parsed, dict):
        raise ValueError('Expected a JSON object')
    pending = [parsed]
    nodes = 0
    while pending:
        value = pending.pop()
        nodes += 1
        if nodes > MAX_JSON_NODES:
            raise ValueError('JSON node limit')
        if isinstance(value, str):
            value.encode('utf-8')  # Reject unpaired UTF-16 surrogates, including object keys.
        elif isinstance(value, dict):
            pending.extend(value.keys())
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={'detail': {'code': code, 'message': message}})


def install_error_handlers(app) -> None:
    async def validation_error(_request, _error):
        # Pydantic errors may include the entire original input, invalid Unicode or NaN.
        return error_response(422, 'INVALID_REQUEST', 'Проверьте поля запроса и допустимую длину текста.')

    app.add_exception_handler(RequestValidationError, validation_error)


class StrictJSONMiddleware:
    def __init__(self, app, max_body_bytes: int = 262144, body_timeout: float = 5.0):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.body_timeout = body_timeout

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        # Match the router's root_path semantics when deployed under a URL prefix.
        path = get_route_path(scope)
        if scope.get('method') in {'POST', 'PATCH', 'PUT', 'DELETE'} and path.startswith('/api/'):
            # Logout has no request model; an empty body is valid for this route only.
            allow_empty = scope.get('method') == 'POST' and path.rstrip('/') == '/api/auth/logout'
            headers = {}
            for name, value in scope.get('headers', []):
                name = name.lower()
                if name in (b'content-length', b'content-type', b'content-encoding', b'transfer-encoding'):
                    if name in headers:
                        await error_response(400, 'INVALID_HEADERS', 'Некорректные заголовки запроса.')(scope, receive, send)
                        return
                    headers[name] = value.decode('latin-1').strip()

            content_type = headers.get(b'content-type', '').lower().split(';')
            media_type = content_type[0].strip()
            json_type = media_type == 'application/json' or (media_type.startswith('application/') and media_type.endswith('+json'))
            parameters = [part.partition('=') for part in content_type[1:]]
            valid_charset = all(name.strip() != 'charset' or value.strip(' "') in ('utf-8', 'utf8')
                                for name, _separator, value in parameters)
            empty_media_type = allow_empty and not media_type
            if (not json_type and not empty_media_type) or not valid_charset or headers.get(b'content-encoding', 'identity').lower() != 'identity':
                await error_response(415, 'UNSUPPORTED_MEDIA_TYPE', 'Используйте несжатый JSON в кодировке UTF-8.')(scope, receive, send)
                return

            if b'transfer-encoding' in headers and (b'content-length' in headers or headers[b'transfer-encoding'].lower() != 'chunked'):
                await error_response(400, 'INVALID_HEADERS', 'Неоднозначные заголовки передачи запроса.')(scope, receive, send)
                return

            expected_length = None
            if b'content-length' in headers:
                raw_length = headers[b'content-length']
                if not raw_length.isascii() or not raw_length.isdecimal() or len(raw_length) > 10:
                    await error_response(400, 'INVALID_HEADERS', 'Некорректная длина запроса.')(scope, receive, send)
                    return
                expected_length = int(raw_length)
                if expected_length > self.max_body_bytes:
                    await error_response(413, 'REQUEST_TOO_LARGE', 'Запрос слишком большой. Сократите текст.')(scope, receive, send)
                    return

            async def read_body():
                body = bytearray()
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return None
                    if message['type'] != 'http.request':
                        raise ValueError('Unexpected body message')
                    chunk = message.get('body', b'')
                    if len(body) + len(chunk) > self.max_body_bytes:
                        raise OverflowError('Body limit')
                    body.extend(chunk)
                    if not message.get('more_body', False):
                        return bytes(body)

            try:
                body = await asyncio.wait_for(read_body(), timeout=self.body_timeout)
            except asyncio.TimeoutError:
                await error_response(408, 'REQUEST_TIMEOUT', 'Не удалось получить запрос вовремя. Повторите отправку.')(scope, receive, send)
                return
            except OverflowError:
                await error_response(413, 'REQUEST_TOO_LARGE', 'Запрос слишком большой. Сократите текст.')(scope, receive, send)
                return
            except ValueError:
                await error_response(400, 'INVALID_REQUEST', 'Некорректное тело запроса.')(scope, receive, send)
                return
            if body is None:
                return
            if expected_length is not None and expected_length != len(body):
                await error_response(400, 'INVALID_HEADERS', 'Длина запроса не совпадает с заголовком.')(scope, receive, send)
                return
            if body and not json_type:
                await error_response(415, 'UNSUPPORTED_MEDIA_TYPE', 'Используйте несжатый JSON в кодировке UTF-8.')(scope, receive, send)
                return
            try:
                if body or not allow_empty:
                    _strict_json(body)
            except (ValueError, UnicodeError, RecursionError, OverflowError):
                await error_response(400, 'INVALID_JSON', 'Некорректный JSON. Проверьте формат запроса.')(scope, receive, send)
                return

            original_receive = receive
            delivered = False

            async def replay_body():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {'type': 'http.request', 'body': body, 'more_body': False}
                return await original_receive()

            receive = replay_body

        started = False

        async def track_response(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
            await send(message)

        try:
            await self.app(scope, receive, track_response)
        except Exception as error:
            if started:
                raise
            logger.error('Unhandled backend error (%s).', type(error).__name__)
            await error_response(500, 'INTERNAL_ERROR', 'Не удалось обработать запрос. Повторите попытку.')(scope, receive, send)
