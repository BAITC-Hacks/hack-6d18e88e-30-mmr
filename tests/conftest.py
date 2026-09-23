"""Keep existing shared-app tests independent without disabling runtime budgets."""

from pathlib import Path
import os
import sys
from tempfile import TemporaryDirectory

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
_account_test_data = TemporaryDirectory(prefix='ai-sana-tests-')
os.environ['DATABASE_PATH'] = str(Path(_account_test_data.name) / 'accounts.sqlite3')
os.environ['MAIL_DIRECTORY'] = str(Path(_account_test_data.name) / 'mail')
os.environ['MAIL_BACKEND'] = 'file'
os.environ['MAIL_WORKER_ENABLED'] = 'false'
os.environ['SMTP_HOST'] = ''
os.environ['SMTP_USER'] = ''
os.environ['SMTP_PASSWORD'] = ''
os.environ.pop('AUTH_PAGE_URL', None)
os.environ.pop('COOKIE_SECURE', None)
os.environ.pop('CORS_ORIGINS', None)
for setting in ('API_ALLOWED_HOSTS', 'API_ALLOWED_ORIGINS', 'API_RATE_LIMIT_PER_CLIENT',
                'API_RATE_LIMIT_GLOBAL', 'API_RATE_LIMIT_WINDOW_SECONDS'):
    os.environ.pop(setting, None)


@pytest.fixture(autouse=True)
def reset_default_api_request_budget():
    from main import app

    # Applications created by individual security tests keep their own budgets.
    app.state.rate_limiter.reset()


def pytest_unconfigure(config):
    _account_test_data.cleanup()
