"""Regressions for combining cookie accounts with the protected AI API."""
from dataclasses import replace
import re
from urllib.parse import urljoin

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.database import connect
from backend.services.security import COOKIE_NAME

ORIGIN = 'http://localhost:8000'
TOKEN = 'local-integration-test-token-32-characters'


@pytest.fixture
def settings(tmp_path):
    return Settings(database_path=tmp_path / 'accounts.sqlite3',
                    mail_directory=tmp_path / 'mail', mail_worker_enabled=False)


@pytest.mark.parametrize('prefix', ['', '/gateway'])
def test_cookie_mutations_require_origin_even_under_gateway_prefix(settings, prefix):
    with TestClient(create_app(settings), base_url=ORIGIN, root_path=prefix) as client:
        headers = {'Cookie': 'ai_sana_session=untrusted-test-session'}
        path = prefix + '/api/auth/logout'
        assert client.post(path, headers=headers).status_code == 403
        assert client.post(path, headers={**headers, 'Origin': 'https://evil.example'}).status_code == 403
        assert client.post(path, headers={**headers, 'Origin': ORIGIN}).status_code == 200


@pytest.mark.parametrize('prefix', ['', '/gateway'])
@pytest.mark.parametrize('body,status', [
    (b'{"newsletter_opt_in":true,"newsletter_opt_in":false}', 400),
    (b'{"newsletter_opt_in":NaN}', 400),
    (b'{"newsletter_opt_in":"\\ud800"}', 400),
    (b'{' + b' ' * 262144 + b'}', 413),
], ids=['duplicate', 'non-finite', 'invalid-unicode', 'oversized'])
def test_preferences_patch_keeps_strict_json_validation(settings, prefix, body, status):
    with TestClient(create_app(settings), base_url=ORIGIN, root_path=prefix) as client:
        response = client.patch(prefix + '/api/auth/preferences', content=body,
                                headers={'Content-Type': 'application/json', 'Origin': ORIGIN})
        assert response.status_code == status
        assert 'newsletter_opt_in' not in response.text


@pytest.mark.parametrize('body,headers', [
    (b'not-json', {}),
    (b'{}', {'Content-Type': 'text/plain'}),
    (b'{}', {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'}),
])
def test_empty_logout_exception_does_not_allow_unchecked_bodies(settings, body, headers):
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        assert client.post('/api/auth/logout', content=body, headers=headers).status_code == 415


def test_account_routes_keep_server_bearer_gate_and_credentialed_cors(settings):
    settings = replace(settings, api_access_token=TOKEN)
    with TestClient(create_app(settings), base_url=ORIGIN, headers={'Origin': ORIGIN}) as client:
        for path in ('/api/auth/register', '/api/mail/campaigns'):
            response = client.post(path, json={})
            assert response.status_code == 401
            assert response.headers['access-control-allow-credentials'] == 'true'
        preflight = client.options('/api/auth/preferences', headers={
            'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type',
        })
        assert preflight.status_code == 200
        assert preflight.headers['access-control-allow-credentials'] == 'true'
        assert 'access-control-allow-credentials' not in client.get('/api/ai/inspector').headers
        response = client.post('/api/auth/register', headers={'Authorization': 'Bearer ' + TOKEN}, json={
            'email': 'integration@example.com', 'password': 'An isolated test password 123!', 'full_name': 'Test Account',
        })
        assert response.status_code == 202


def test_account_patch_consumes_outer_request_budget(settings):
    with TestClient(create_app(replace(settings, rate_limit_per_client=1)), base_url=ORIGIN) as client:
        assert client.patch('/api/auth/preferences', json={'newsletter_opt_in': True}).status_code == 401
        response = client.patch('/api/auth/preferences', json={'newsletter_opt_in': True})
        assert response.status_code == 429
        assert int(response.headers['retry-after']) > 0


def test_production_account_settings_require_secure_cookies_and_links(tmp_path):
    options = dict(environment='production', api_access_token=TOKEN,
                   allowed_hosts=('api.example.test',), allowed_origins=('https://app.example.test',),
                   database_path=tmp_path / 'accounts.sqlite3', mail_worker_enabled=False)
    settings = Settings(**options)
    assert settings.cookie_secure is True
    assert settings.auth_page_url.startswith('https://')
    with pytest.raises(ValueError):
        Settings(**options, cookie_secure=False)
    with pytest.raises(ValueError):
        Settings(**options, auth_page_url='http://app.example.test/account')


@pytest.mark.parametrize('prefix', ['', '/gateway'])
def test_account_session_and_page_assets_work_under_mount_prefix(settings, prefix):
    with TestClient(create_app(settings), base_url=ORIGIN, root_path=prefix, headers={'Origin': ORIGIN}) as client:
        api = prefix + '/api/auth/'
        payload = {'email': 'mounted@example.com', 'password': 'An isolated test password 123!', 'full_name': 'Mounted Account'}
        assert client.post(api + 'register', json=payload).status_code == 202
        with connect(settings) as db:
            body = db.execute('SELECT body FROM outbox ORDER BY id DESC LIMIT 1').fetchone()['body']
        token = re.search(r'#verify=([\w-]+)', body).group(1)
        assert client.post(api + 'verify-email', json={'token': token}).status_code == 200
        login = client.post(api + 'login', json={key: payload[key] for key in ('email', 'password')})
        assert login.status_code == 200
        assert f'Path={prefix}/api' in login.headers['set-cookie']
        # The client must select the cookie itself, exactly as a browser would.
        assert client.get(api + 'me').status_code == 200
        page_path = prefix + '/account'
        page = client.get(page_path)
        assert page.status_code == 200
        for asset in re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', page.text):
            assert client.get(urljoin(page_path, asset)).status_code == 200
        assert client.post(api + 'logout').status_code == 200
        assert client.cookies.get(COOKIE_NAME) is None
        assert client.get(api + 'me').status_code == 401
