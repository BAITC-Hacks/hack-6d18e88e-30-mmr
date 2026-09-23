"""Small, local regression cases for the JSON boundary; not a load test."""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from main import app

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', '')
    monkeypatch.setenv('NVIDIA_API_KEY', '')


def post_raw(body, **kwargs):
    return client.post('/api/ai/analyze', content=body, headers={'Content-Type': 'application/json'}, **kwargs)


def test_duplicate_json_keys_do_not_override_guard_input():
    response = post_raw('{"draft":"Реши 2+2","draft":"Нужен бот"}'.encode())
    assert response.status_code == 400


def test_validation_response_does_not_echo_submitted_values():
    response = client.post('/api/ai/analyze', json={'draft': 'Нужен бот', 'industry': {'private': 'sensitive-business-text'}})
    assert response.status_code == 422
    assert 'sensitive-business-text' not in response.text
    assert 'input' not in response.text


@pytest.mark.parametrize('body', [
    b'{"draft": NaN}', b'{"draft": Infinity}', b'{"draft": 1e999}',
    b'{"draft":"invalid\\ud800"}', b'{"draft":"bad\xff"}',
    b'{"draft": "incomplete', b'[]', b'null',
    b'{"draft":' + b'[' * 40 + b'0' + b']' * 40 + b'}',
])
def test_malformed_or_ambiguous_json_is_a_safe_client_error(body):
    response = post_raw(body)
    assert response.status_code == 400
    assert response.json()['detail']['code'] == 'INVALID_JSON'
    assert 'Traceback' not in response.text


def test_body_limit_applies_before_schema_validation():
    response = post_raw(b'{"draft":"' + b'x' * 262144 + b'"}')
    assert response.status_code == 413


@pytest.mark.parametrize('headers', [
    {'Content-Type': 'text/plain'}, {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'},
    {'Content-Type': 'application/json; charset=utf-16'},
    {'Content-Type': 'application/json; charset = "utf-16"'},
])
def test_only_uncompressed_utf8_json_is_accepted(headers):
    response = client.post('/api/ai/analyze', content=b'{}', headers=headers)
    assert response.status_code == 415


@pytest.mark.parametrize('length', ['-1', 'invalid', '0', '999999'])
def test_invalid_or_inconsistent_content_length(length):
    response = client.post('/api/ai/analyze', content=b'{}', headers={
        'Content-Type': 'application/json', 'Content-Length': length,
    })
    assert response.status_code == (413 if length == '999999' else 400)


def test_conflicting_transfer_headers_are_rejected():
    response = client.post('/api/ai/analyze', content=b'{}', headers={
        'Content-Type': 'application/json', 'Content-Length': '2', 'Transfer-Encoding': 'chunked',
    })
    assert response.status_code == 400


@pytest.mark.parametrize('body,status', [
    (b'{"draft":"one","draft":"two"}', 400),
    (b'{"draft":' + b'[' * 40 + b'0' + b']' * 40 + b'}', 400),
    (b'{"draft":"' + b'x' * 262144 + b'"}', 413),
], ids=['duplicate-keys', 'deep-json', 'oversized-body'])
def test_deployment_prefix_cannot_bypass_body_guard(body, status):
    prefixed = TestClient(app, root_path='/prefix')
    response = prefixed.post('/prefix/api/ai/analyze', content=body, headers={'Content-Type': 'application/json'})
    assert response.status_code == status


def test_clarification_question_id_has_a_bound():
    response = client.post('/api/ai/generate-card', json={
        'draft': 'Нужен бот', 'answers': [{'questionId': 'q' * 201, 'field': 'constraints', 'answer': 'Python'}],
    })
    assert response.status_code == 422


def test_total_text_limit_bounds_normalization_and_prompt_work():
    response = client.post('/api/ai/generate-card', json={
        'draft': 'Нужен бот', 'answers': [
            {'questionId': f'q-{index}', 'field': 'constraints', 'answer': 'x' * 10000}
            for index in range(6)
        ],
    })
    assert response.status_code == 422


def test_valid_unicode_and_maximum_draft_still_work():
    draft = 'Нужен бот для заказов 🛒. ' + 'а' * 19000
    response = client.post('/api/ai/generate-card', json={'draft': draft})
    assert response.status_code == 200
    assert response.json()['context'] == draft


async def call_body_guard(chunks, *, max_body_bytes=64, body_timeout=0.05, fail=False, disconnect=False):
    from request_validation import StrictJSONMiddleware
    sent = []
    called = []
    pending = list(chunks)

    async def downstream(scope, receive, send):
        called.append(True)
        if fail:
            raise RuntimeError('sensitive-unexpected-error')
        message = await receive()
        assert isinstance(json.loads(message['body']), dict)
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'ok'})

    async def receive():
        if pending:
            return pending.pop(0)
        if disconnect:
            return {'type': 'http.disconnect'}
        await asyncio.sleep(1)
        raise AssertionError('The deadline should have cancelled the stalled receive')

    async def send(message):
        sent.append(message)

    middleware = StrictJSONMiddleware(downstream, max_body_bytes=max_body_bytes, body_timeout=body_timeout)
    await middleware({'type': 'http', 'method': 'POST', 'path': '/api/ai/analyze',
                      'headers': [(b'content-type', b'application/json')]}, receive, send)
    return sent, called


def test_chunked_size_limit_does_not_trust_content_length():
    messages, called = asyncio.run(call_body_guard([
        {'type': 'http.request', 'body': b'{' + b' ' * 32, 'more_body': True},
        {'type': 'http.request', 'body': b' ' * 32 + b'}', 'more_body': False},
    ]))
    assert messages[0]['status'] == 413
    assert called == []


def test_total_body_deadline_stops_stalled_input():
    messages, called = asyncio.run(call_body_guard([{'type': 'http.request', 'body': b'{', 'more_body': True}]))
    assert messages[0]['status'] == 408
    assert called == []


def test_disconnect_is_not_reported_as_a_server_error():
    messages, called = asyncio.run(call_body_guard([], disconnect=True))
    assert messages == [] and called == []


def test_unexpected_errors_are_not_reflected_or_logged(caplog):
    messages, called = asyncio.run(call_body_guard([{'type': 'http.request', 'body': b'{}', 'more_body': False}], fail=True))
    assert called == [True] and messages[0]['status'] == 500
    assert b'sensitive-unexpected-error' not in messages[1]['body']
    assert 'sensitive-unexpected-error' not in caplog.text
