"""Regression coverage for malformed providers, grounded fallback and human review."""

import asyncio
import copy
import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from main import app
from schemas.ai import AnalyzeDraftRequest, AnalyzeDraftResponse
from services import ai_engine

client = TestClient(app)
COMPLETE_DRAFT = (
    "Сейчас оператор обрабатывает заказы вручную. Хотим автоматизировать обработку. "
    "Данные: CSV с 1200 заказами за год. Нужен работающий прототип сервиса. "
    "Срок: 3 недели, Python. Критерий: точность 95%. "
    "Контакт: lead@example.com. Созвоны каждую пятницу."
)


@pytest.fixture(autouse=True)
def disable_external_ai(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)


def provider_output():
    return {
        "detectedFields": {
            "context": {"value": "Сейчас оператор обрабатывает заказы вручную.", "source": "draft", "confidence": 0.8},
        },
        "missingFields": ["availableData", "successCriteria", "constraints"],
        "questions": [
            {"id": "q-data", "field": "availableData", "question": "Какие данные доступны?"},
            {"id": "q-success", "field": "successCriteria", "question": "Как измеряется успех?"},
            {"id": "q-constraints", "field": "constraints", "question": "Какие сроки?"},
        ],
    }


def mock_provider(monkeypatch, *, content=None, status=200, body=None, error=None):
    """Replace only the external AsyncClient; never perform a network request."""
    calls = []
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-placeholder")

    class ProviderClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        @asynccontextmanager
        async def stream(self, method, url, **kwargs):
            response = await self.post(url, **kwargs)
            streamed = httpx.Response(
                response.status_code, headers=response.headers, request=response.request,
                stream=httpx.ByteStream(response.content),
            )
            try:
                yield streamed
            finally:
                await streamed.aclose()

        async def post(self, url, **kwargs):
            calls.append(kwargs)
            if error:
                raise error
            response_body = body if body is not None else {
                "choices": [{"message": {"content": content}}],
            }
            return httpx.Response(status, json=response_body, request=httpx.Request("POST", url))

    monkeypatch.setattr(ai_engine.httpx, "AsyncClient", ProviderClient)
    return calls


def test_fully_populated_fallback_still_asks_three_distinct_questions():
    result = ai_engine.local_fallback_analyze(COMPLETE_DRAFT)
    assert result.missingFields == []
    assert len(result.questions) >= 3
    assert len({q.field for q in result.questions}) == len(result.questions)
    assert all(field.value in COMPLETE_DRAFT for field in result.detectedFields.values())
    assert result.detectedFields["availableData"].value == "Данные: CSV с 1200 заказами за год."
    assert result.detectedFields["successCriteria"].value == "Критерий: точность 95%."


def test_fallback_preserves_negative_data_statement_and_avoids_substring_matches():
    draft = "Нужен чат-бот. Данных нет, CSV не предоставим. Это задача по логистике."
    result = ai_engine.local_fallback_analyze(draft)
    assert result.detectedFields["availableData"].value == "Данных нет, CSV не предоставим."
    assert "consultationFormat" in result.missingFields
    no_data = ai_engine.local_fallback_analyze("Нужна помощь по логистике, сотрудники работают вручную.")
    assert "availableData" in no_data.missingFields
    assert "expectedResult" in no_data.missingFields


def test_card_retains_draft_facts_and_applies_title_context_answers():
    response = client.post("/api/ai/generate-card", json={
        "draft": COMPLETE_DRAFT,
        "answers": [
            {"questionId": "q-title", "field": "title", "answer": "  Заказы склада  "},
            {"questionId": "q-context", "field": "context", "answer": "Ручная обработка заказов склада"},
            {"questionId": "q-data", "field": "availableData", "answer": "   "},
        ],
    })
    assert response.status_code == 200
    card = response.json()
    assert card["title"] == "Заказы склада"
    assert card["context"] == "Ручная обработка заказов склада"
    assert card["availableData"] == "Данные: CSV с 1200 заказами за год."
    assert card["constraints"] == "Срок: 3 недели, Python."
    assert card["confirmedFields"] == []
    assert card["confirmed"] is False and card["published"] is False
    assert card["industry"] == "" and card["tags"] == []


def test_weak_card_does_not_invent_communication_or_metadata():
    card = client.post("/api/ai/generate-card", json={"draft": "Нужен бот", "answers": []}).json()
    assert card["consultationFormat"] == ""
    assert card["contact"] == ""
    assert card["industry"] == ""
    assert card["tags"] == []
    assert card["confirmedFields"] == []


@pytest.mark.parametrize("endpoint", ["analyze", "generate-card"])
def test_separator_only_draft_is_rejected_as_off_topic(endpoint):
    response = client.post(f"/api/ai/{endpoint}", json={"draft": ";;;;;"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "OFF_TOPIC"


@pytest.mark.parametrize("endpoint", ["analyze", "generate-card"])
@pytest.mark.parametrize("draft", ["     ", "1234", 12345, "x" * 20001])
def test_rejects_invalid_drafts(endpoint, draft):
    assert client.post(f"/api/ai/{endpoint}", json={"draft": draft}).status_code == 422


@pytest.mark.parametrize("field", ["published", "rating", "id", "__proto__"])
def test_answers_cannot_modify_task_state(field):
    response = client.post("/api/ai/generate-card", json={
        "draft": "Нужен бот",
        "answers": [{"questionId": "q", "field": field, "answer": "true"}],
    })
    assert response.status_code == 422


def test_valid_provider_output_is_used_and_inspector_exposes_actual_prompt(monkeypatch):
    calls = mock_provider(monkeypatch, content=json.dumps(provider_output(), ensure_ascii=False))
    response = client.post("/api/ai/analyze", json={"draft": COMPLETE_DRAFT, "industry": "Логистика"})
    result = response.json()
    assert response.status_code == 200
    assert result["provider"] == "openai" and result["fallbackUsed"] is False
    assert "reason" not in result["questions"][0]
    inspector = client.get("/api/ai/inspector").json()
    expected_prompt = inspector["analysisPromptTemplate"].replace(
        "{input_json}", json.dumps({"draft": COMPLETE_DRAFT, "industry": "Логистика"}, ensure_ascii=False), 1,
    )
    assert calls[0]["json"]["messages"][1]["content"] == expected_prompt
    assert inspector["inputJsonSchema"] == AnalyzeDraftRequest.model_json_schema()
    assert inspector["outputJsonSchema"] == AnalyzeDraftResponse.model_json_schema()
    assert inspector["outputJsonSchema"]["additionalProperties"] is False


INVALID_CONTENT = ["not JSON", "[]", '{"questions":[]}', '{"a":1,"a":2}', '{"a":NaN}']


@pytest.mark.parametrize("content", INVALID_CONTENT)
def test_bad_provider_json_falls_back(monkeypatch, content):
    mock_provider(monkeypatch, content=content)
    result = asyncio.run(ai_engine.analyze_draft_with_ai(COMPLETE_DRAFT))
    assert result.fallbackUsed is True and len(result.questions) >= 3


@pytest.mark.parametrize("defect", [
    "confidence", "source", "unknown_field", "unknown_property", "missing_property",
    "duplicate_id", "duplicate_field", "empty_question", "contradiction", "invented_fact", "too_many_questions",
])
def test_schema_or_grounding_errors_trigger_fallback(monkeypatch, defect):
    output = copy.deepcopy(provider_output())
    if defect == "confidence":
        output["detectedFields"]["context"]["confidence"] = 1.5
    elif defect == "source":
        output["detectedFields"]["context"]["source"] = "manual"
    elif defect == "unknown_field":
        output["questions"][0]["field"] = "rating"
    elif defect == "unknown_property":
        output["published"] = True
    elif defect == "missing_property":
        del output["detectedFields"]
    elif defect == "duplicate_id":
        output["questions"][1]["id"] = output["questions"][0]["id"]
    elif defect == "duplicate_field":
        output["questions"][1]["field"] = output["questions"][0]["field"]
    elif defect == "empty_question":
        output["questions"][0]["question"] = "   "
    elif defect == "contradiction":
        output["missingFields"].append("context")
    elif defect == "invented_fact":
        output["detectedFields"]["context"]["value"] = "Компания продаёт 100000 товаров в день"
    elif defect == "too_many_questions":
        output["questions"].extend([
            {"id": "q-contact", "field": "contact", "question": "Как связаться?"},
            {"id": "q-users", "field": "targetUsers", "question": "Кто пользователи?"},
        ])
    mock_provider(monkeypatch, content=json.dumps(output, ensure_ascii=False))
    result = asyncio.run(ai_engine.analyze_draft_with_ai(COMPLETE_DRAFT))
    assert result.fallbackUsed is True


@pytest.mark.parametrize("status", [401, 429, 500])
def test_http_errors_fall_back_without_logging_provider_body(monkeypatch, caplog, status):
    mock_provider(monkeypatch, status=status, body={"error": "secret-do-not-log"})
    result = asyncio.run(ai_engine.analyze_draft_with_ai(COMPLETE_DRAFT))
    assert result.fallbackUsed is True
    assert "secret-do-not-log" not in caplog.text
    assert "unit-test-placeholder" not in caplog.text


@pytest.mark.parametrize("body", [{}, {"choices": []}, {"choices": [{"message": {"content": None}}]}])
def test_malformed_provider_envelope_falls_back(monkeypatch, body):
    mock_provider(monkeypatch, body=body)
    assert asyncio.run(ai_engine.analyze_draft_with_ai(COMPLETE_DRAFT)).fallbackUsed is True


def test_timeout_falls_back_without_logging_exception(monkeypatch, caplog):
    mock_provider(monkeypatch, error=httpx.ReadTimeout("secret-do-not-log"))
    assert asyncio.run(ai_engine.analyze_draft_with_ai(COMPLETE_DRAFT)).fallbackUsed is True
    assert "secret-do-not-log" not in caplog.text


def test_total_deadline_cancels_stalled_provider(monkeypatch):
    mock_provider(monkeypatch)
    monkeypatch.setattr(ai_engine, "AI_TIMEOUT_SECONDS", 0.01)
    cancelled = []

    async def stall(self, *args, **kwargs):
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise

    monkeypatch.setattr(ai_engine.httpx.AsyncClient, "post", stall)
    assert asyncio.run(ai_engine.analyze_draft_with_ai(COMPLETE_DRAFT)).fallbackUsed is True
    assert cancelled == [True]


@pytest.mark.parametrize("text", [
    'prefix {"valid":true}', '{"a":1,"a":2}', '{"value":Infinity}', '{"value":NaN}', '[]',
])
def test_json_parser_rejects_ambiguous_or_nonstandard_json(text):
    assert ai_engine._json_from_text(text) == {}
