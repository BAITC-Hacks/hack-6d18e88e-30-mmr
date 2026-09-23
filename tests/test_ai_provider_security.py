"""Bounded provider transport regressions; every external call uses MockTransport."""

import asyncio
import json
import os
import sys
import threading
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from services import ai_engine

REAL_ASYNC_CLIENT = httpx.AsyncClient
DRAFT = "Нужен бот для заказов"


@pytest.fixture(autouse=True)
def fake_credentials(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-key-never-real")
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("AI_MODEL", raising=False)


def valid_content():
    return json.dumps({
        "detectedFields": {"need": {"value": DRAFT, "source": "draft"}},
        "missingFields": ["availableData", "constraints", "successCriteria"],
        "questions": [
            {"id": field, "field": field, "question": "Уточните требования"}
            for field in ("availableData", "constraints", "successCriteria")
        ],
    }, ensure_ascii=False)


def envelope(content=None):
    return json.dumps({"choices": [{"message": {"content": content if content is not None else valid_content()}}]}).encode()


class TrackedStream(httpx.AsyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks
        self.read_count = 0
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            self.read_count += 1
            yield chunk

    async def aclose(self):
        self.closed = True


def mock_transport(monkeypatch, handler):
    config = []
    requests = []

    async def transport_handler(request):
        requests.append(request)
        return await handler(request)

    def factory(**kwargs):
        config.append(kwargs)
        return REAL_ASYNC_CLIENT(transport=httpx.MockTransport(transport_handler), **kwargs)

    monkeypatch.setattr(ai_engine.httpx, "AsyncClient", factory)
    return requests, config


def configure_body(monkeypatch, body, *, status=200, headers=None):
    stream = TrackedStream([body])

    async def handler(request):
        return httpx.Response(status, headers=headers or {}, stream=stream)

    requests, config = mock_transport(monkeypatch, handler)
    return stream, requests, config


def analyze():
    return asyncio.run(ai_engine.analyze_draft_with_ai(DRAFT))


def test_deeply_nested_content_falls_back_instead_of_recursion_crash(monkeypatch):
    configure_body(monkeypatch, envelope('{"nested":' + '[' * 2000 + '0' + ']' * 2000 + '}'))
    assert analyze().fallbackUsed is True


def test_json_extractor_rejects_excessive_depth_without_raising():
    assert ai_engine._json_from_text('{"nested":' + '[' * 2000 + '0' + ']' * 2000 + '}') == {}


def test_deeply_nested_envelope_falls_back_instead_of_recursion_crash(monkeypatch):
    configure_body(monkeypatch, b'{"nested":' + b'[' * 2000 + b'0' + b']' * 2000 + b'}')
    assert analyze().fallbackUsed is True


@pytest.mark.parametrize("body", [
    b'{"choices": [], "choices": []}', b'{"extra":NaN}', b'{"extra":1e99999}', b'\xff',
    b'{"extra":"\\ud800"}',
])
def test_provider_envelope_requires_strict_finite_utf8_json(monkeypatch, body):
    stream, _, _ = configure_body(monkeypatch, body)
    assert analyze().fallbackUsed is True
    assert stream.closed


def test_valid_content_cannot_be_smuggled_after_duplicate_envelope_key(monkeypatch):
    body = b'{"choices": [],' + envelope()[1:]
    configure_body(monkeypatch, body)
    assert analyze().fallbackUsed is True


def test_valid_content_cannot_hide_nonfinite_envelope_number(monkeypatch):
    body = b'{"ignored":1e99999,' + envelope()[1:]
    configure_body(monkeypatch, body)
    assert analyze().fallbackUsed is True


def test_invalid_charset_label_never_controls_json_decoding(monkeypatch):
    configure_body(monkeypatch, envelope(), headers={"Content-Type": "application/json; charset=invalid-codec"})
    assert analyze().fallbackUsed is False


@pytest.mark.parametrize("key", ["секрет", "unit-test\r\nX-Injected: yes", "key with spaces", "x" * 4097])
def test_invalid_provider_key_is_rejected_before_transport(monkeypatch, key):
    monkeypatch.setenv("OPENAI_API_KEY", key)

    def forbidden(**kwargs):
        pytest.fail("Invalid provider configuration must not construct a transport")

    monkeypatch.setattr(ai_engine.httpx, "AsyncClient", forbidden)
    assert analyze().fallbackUsed is True


@pytest.mark.parametrize("model", ["bad\nmodel", "\ud800", "x" * 201])
def test_invalid_model_configuration_falls_back_before_transport(monkeypatch, model):
    # POSIX cannot store lone surrogates in the environment. Simulate the
    # malformed configuration on every platform, preserving other env reads.
    original_get = os.environ.get
    monkeypatch.setattr(os.environ, "get", lambda key, default=None:
                        model if key == "AI_MODEL" else original_get(key, default))

    def forbidden(**kwargs):
        pytest.fail("Invalid model configuration must not construct a transport")

    monkeypatch.setattr(ai_engine.httpx, "AsyncClient", forbidden)
    assert analyze().fallbackUsed is True


def test_declared_oversized_response_is_closed_without_reading_body(monkeypatch):
    stream, _, _ = configure_body(monkeypatch, b"not read", headers={"Content-Length": str(128 * 1024 + 1)})
    assert analyze().fallbackUsed is True
    assert stream.read_count == 0
    assert stream.closed


def test_chunked_oversized_response_stops_reading_at_limit(monkeypatch):
    stream = TrackedStream([b"x" * 8192] * 100)

    async def handler(request):
        return httpx.Response(200, stream=stream)

    mock_transport(monkeypatch, handler)
    assert analyze().fallbackUsed is True
    assert stream.read_count <= 17
    assert stream.closed


def test_compressed_response_is_rejected_without_decompression(monkeypatch):
    stream, _, _ = configure_body(monkeypatch, b"not read", headers={"Content-Encoding": "gzip"})
    assert analyze().fallbackUsed is True
    assert stream.read_count == 0
    assert stream.closed


def test_inner_model_content_has_its_own_limit(monkeypatch):
    configure_body(monkeypatch, envelope(valid_content() + " " * (64 * 1024)))
    assert analyze().fallbackUsed is True


def test_outbound_request_limits_generation_and_ignores_proxy_environment(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9")
    _, requests, config = configure_body(monkeypatch, envelope())
    assert analyze().fallbackUsed is False
    assert config[0]["trust_env"] is False
    assert config[0]["follow_redirects"] is False
    assert str(requests[0].url) == "https://api.openai.com/v1/chat/completions"
    assert requests[0].headers["Accept-Encoding"] == "identity"
    assert json.loads(requests[0].content)["max_tokens"] == 2048


def test_redirect_does_not_send_authorization_to_another_host(monkeypatch, caplog):
    _, requests, config = configure_body(
        monkeypatch, b"secret-provider-body", status=307,
        headers={"Location": "https://other.invalid/collect"},
    )
    assert analyze().fallbackUsed is True
    assert len(requests) == 1
    assert requests[0].url.host == "api.openai.com"
    assert config[0]["follow_redirects"] is False
    assert "secret-provider-body" not in caplog.text
    assert "unit-test-key-never-real" not in caplog.text


def test_nvidia_also_uses_only_its_fixed_https_endpoint(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("NVIDIA_API_KEY", "unit-test-nvidia-never-real")
    monkeypatch.setenv("AI_BASE_URL", "https://other.invalid/collect")
    _, requests, _ = configure_body(monkeypatch, envelope())
    result = analyze()
    assert result.fallbackUsed is False and result.provider == "nvidia"
    assert str(requests[0].url) == "https://integrate.api.nvidia.com/v1/chat/completions"


def test_saturated_provider_capacity_immediately_uses_local_fallback(monkeypatch):
    monkeypatch.setattr(ai_engine, "_provider_slots", threading.BoundedSemaphore(1))

    async def scenario():
        started = asyncio.Event()
        release = asyncio.Event()

        async def handler(request):
            started.set()
            await release.wait()
            return httpx.Response(200, stream=TrackedStream([envelope()]))

        requests, _ = mock_transport(monkeypatch, handler)
        first = asyncio.create_task(ai_engine.analyze_draft_with_ai(DRAFT))
        await asyncio.wait_for(started.wait(), timeout=1)
        second = await ai_engine.analyze_draft_with_ai(DRAFT)
        assert second.fallbackUsed is True
        assert len(requests) == 1
        release.set()
        assert (await first).fallbackUsed is False
        assert (await ai_engine.analyze_draft_with_ai(DRAFT)).fallbackUsed is False

    asyncio.run(scenario())


def test_cancellation_releases_provider_slot(monkeypatch):
    monkeypatch.setattr(ai_engine, "_provider_slots", threading.BoundedSemaphore(1))

    async def scenario():
        started = asyncio.Event()
        call_count = 0

        async def handler(request):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                started.set()
                await asyncio.Event().wait()
            return httpx.Response(200, stream=TrackedStream([envelope()]))

        mock_transport(monkeypatch, handler)
        first = asyncio.create_task(ai_engine.analyze_draft_with_ai(DRAFT))
        await asyncio.wait_for(started.wait(), timeout=1)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert (await ai_engine.analyze_draft_with_ai(DRAFT)).fallbackUsed is False

    asyncio.run(scenario())


def test_deadline_covers_stalled_response_body_and_releases_slot(monkeypatch):
    monkeypatch.setattr(ai_engine, "_provider_slots", threading.BoundedSemaphore(1))
    monkeypatch.setattr(ai_engine, "AI_TIMEOUT_SECONDS", 0.01)

    class StalledBody(TrackedStream):
        async def __aiter__(self):
            yield b'{"choices":'
            await asyncio.Event().wait()

    stalled = StalledBody([])

    async def scenario():
        call_count = 0

        async def handler(request):
            nonlocal call_count
            call_count += 1
            return httpx.Response(200, stream=stalled if call_count == 1 else TrackedStream([envelope()]))

        mock_transport(monkeypatch, handler)
        assert (await ai_engine.analyze_draft_with_ai(DRAFT)).fallbackUsed is True
        assert stalled.closed
        assert (await ai_engine.analyze_draft_with_ai(DRAFT)).fallbackUsed is False

    asyncio.run(scenario())
