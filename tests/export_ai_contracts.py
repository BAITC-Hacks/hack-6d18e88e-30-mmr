"""Export real offline API responses for the TypeScript boundary contract check."""

import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

# Empty explicit values prevent dotenv from enabling any provider during this check.
os.environ["OPENAI_API_KEY"] = ""
os.environ["NVIDIA_API_KEY"] = ""
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ["APP_ENV"] = "development"
os.environ["API_ACCESS_TOKEN"] = ""
os.environ["AUTH_PROVIDER"] = "local"
os.environ["MAIL_BACKEND"] = "file"
os.environ["MAIL_WORKER_ENABLED"] = "false"
for setting in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
                "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"):
    os.environ[setting] = ""
for setting in ("API_ALLOWED_HOSTS", "API_ALLOWED_ORIGINS", "API_RATE_LIMIT_PER_CLIENT",
                "API_RATE_LIMIT_GLOBAL", "API_RATE_LIMIT_WINDOW_SECONDS"):
    os.environ.pop(setting, None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient
from main import create_app
from backend.config import Settings as AccountSettings


def export_contracts():
    # A contract check must never read/mutate the developer's users or mail queue.
    with TemporaryDirectory(prefix="ai-sana-contract-") as temp:
        settings = AccountSettings(database_path=Path(temp) / "accounts.sqlite3",
                                   mail_directory=Path(temp) / "mail", mail_worker_enabled=False)
        app = create_app(account_settings=settings)
        with TestClient(app) as client:
            return read_contracts(client)


def read_contracts(client):
    payload = {"draft": "Нужен бот для заказов", "industry": ""}
    analysis = client.post("/api/ai/analyze", json=payload)
    card = client.post("/api/ai/generate-card", json={**payload, "answers": []})
    inspector = client.get("/api/ai/inspector")
    for response in (analysis, card, inspector):
        response.raise_for_status()
    return {"analysis": analysis.json(), "card": card.json(), "inspector": inspector.json()}


if __name__ == "__main__":
    print(json.dumps(export_contracts(), ensure_ascii=True))
