"""Unit and integration test suite for AI Sana TaskRank Backend."""

import os
import sys

# Ensure backend folder is on python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from fastapi.testclient import TestClient
from main import app
from services.ai_engine import local_fallback_analyze, _json_from_text

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "ai-sana-taskrank"


def test_local_fallback_guarantees_minimum_three_questions():
    draft = "Нужен чат-бот для заказов"
    res = local_fallback_analyze(draft, "Retail")
    assert len(res.questions) >= 3
    assert res.fallbackUsed is True
    assert "availableData" in res.missingFields or any(q.field == "availableData" for q in res.questions)


def test_analyze_draft_endpoint():
    payload = {
        "draft": "Хотим автоматизировать склад паллет на Python. Теряются коробки.",
        "industry": "Логистика",
    }
    response = client.post("/api/ai/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "detectedFields" in data
    assert "missingFields" in data
    assert len(data["questions"]) >= 3
    assert data["provider"] is not None


def test_generate_card_endpoint_preserves_facts_without_hallucinations():
    payload = {
        "draft": "Хотим автоматизировать склад паллет на Python. Теряются коробки.",
        "industry": "Логистика",
        "answers": [
            {
                "questionId": "q-data",
                "field": "availableData",
                "answer": "Выгрузка инвентаризации в CSV за 2025 год",
            },
            {
                "questionId": "q-success",
                "field": "successCriteria",
                "answer": "Сокращение времени поиска коробки с 20 минут до 2 минут",
            },
            {
                "questionId": "q-contact",
                "field": "contact",
                "answer": "Telegram: @logistics_lead",
            },
        ],
    }
    response = client.post("/api/ai/generate-card", json=payload)
    assert response.status_code == 200
    card = response.json()
    assert card["availableData"] == "Выгрузка инвентаризации в CSV за 2025 год"
    assert card["successCriteria"] == "Сокращение времени поиска коробки с 20 минут до 2 минут"
    assert card["contact"] == "Telegram: @logistics_lead"
    assert card["confirmed"] is False
    assert card["published"] is False


def test_inspector_endpoint():
    response = client.get("/api/ai/inspector")
    assert response.status_code == 200
    data = response.json()
    assert "systemPrompt" in data
    assert len(data["safetyRules"]) >= 3
    assert "inputJsonSchema" in data
    assert "outputJsonSchema" in data


def test_json_from_text_strips_markdown_codeblocks():
    raw_markdown = "```json\n{\"testKey\": \"testValue\", \"number\": 42}\n```"
    parsed = _json_from_text(raw_markdown)
    assert parsed.get("testKey") == "testValue"
    assert parsed.get("number") == 42
