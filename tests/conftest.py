"""Keep existing shared-app tests independent without disabling runtime budgets."""

from pathlib import Path
import os
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

# Tests must never inherit real provider keys or production access settings.
# Individual security tests explicitly configure isolated apps or monkeypatch env.
os.environ['PYTHON_DOTENV_DISABLED'] = '1'
os.environ['OPENAI_API_KEY'] = ''
os.environ['NVIDIA_API_KEY'] = ''
os.environ['AI_MODEL'] = ''
os.environ['APP_ENV'] = 'development'
os.environ['API_ACCESS_TOKEN'] = ''
for setting in ('API_ALLOWED_HOSTS', 'API_ALLOWED_ORIGINS', 'API_RATE_LIMIT_PER_CLIENT',
                'API_RATE_LIMIT_GLOBAL', 'API_RATE_LIMIT_WINDOW_SECONDS'):
    os.environ.pop(setting, None)

# Every app lifespan now initializes account storage. Never open the developer's
# database or let inherited SMTP settings start an external delivery worker.
_account_test_directory = TemporaryDirectory(prefix='ai-sana-tests-')
os.environ['DATABASE_PATH'] = str(Path(_account_test_directory.name) / 'accounts.sqlite3')
os.environ['MAIL_DIRECTORY'] = str(Path(_account_test_directory.name) / 'mail')
os.environ['MAIL_BACKEND'] = 'file'
os.environ['AUTH_PROVIDER'] = 'local'
os.environ['AUTH_MAIL_FORMAT'] = 'html'
os.environ.pop('UNSUBSCRIBE_PAGE_URL', None)
for setting in ('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'):
    os.environ.pop(setting, None)
os.environ['MAIL_WORKER_ENABLED'] = 'false'
os.environ['MAIL_FROM'] = 'AI Sana <noreply@example.test>'
os.environ.pop('AUTH_PAGE_URL', None)
os.environ.pop('COOKIE_SECURE', None)
os.environ['SESSION_HOURS'] = '24'
os.environ['SMTP_PORT'] = '587'
for setting in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'CORS_ORIGINS'):
    os.environ.pop(setting, None)


def pytest_sessionfinish(session, exitstatus):
    _account_test_directory.cleanup()


@pytest.fixture(autouse=True)
def reset_default_api_request_budget():
    from main import app

    # Applications created by individual security tests keep their own budgets.
    app.state.rate_limiter.reset()


@pytest.fixture(autouse=True)
def prohibit_live_supabase_calls():
    # Provider tests replace this with their own streaming mock. A missed mock
    # must fail locally before it can contact a project on the network.
    with patch("backend.services.supabase_gateway.httpx.stream", side_effect=AssertionError("Unexpected live Supabase request")):
        yield
