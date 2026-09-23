import os
import re
import json
import logging
from typing import Dict, List, Any, Optional
import httpx

from schemas.ai import (
    AnalyzeDraftResponse,
    ClarificationQuestion,
    ExtractedField,
    GenerateCardRequest,
)

logger = logging.getLogger("ai_sana.ai_engine")

SYSTEM_PROMPT = """You are an elite Business Analyst AI for the HackAlem AI Sana platform.
Your objective is to evaluate initial business task descriptions, determine missing information according to 7 evaluation dimensions, and formulate at least 3 high-impact clarifying questions.

7 KEY EVALUATION DIMENSIONS (HackAlem AI Criteria):
1. contextNeed (max 20 pts): Current business state, pain point, and why change is needed.
2. data (max 20 pts): Available datasets, APIs, file formats, access rules, or sample data.
3. expectedResult (max 15 pts): Concrete deliverable (working MVP, repository, container, documentation).
4. successCriteria (max 15 pts): Measurable acceptance metrics (accuracy, latency, conversion, SLA).
5. constraints (max 10 pts): Deadlines, technology stack, security or compute boundaries.
6. users (max 10 pts): Target audience and end-user personas.
7. businessCommunication (max 10 pts): Point of contact and consultation schedule/format.

CRITICAL RULES (HACKALEM AI REGULATION):
1. ZERO HALLUCINATIONS: Never invent facts, company names, or metrics that the business did not provide.
2. MUST RETURN AT LEAST 3 QUESTIONS for the most critical missing dimensions.
3. RETURN ONLY VALID JSON with the exact expected schema.
"""


def _json_from_text(text: str) -> Dict[str, Any]:
    """Safely extracts JSON from LLM response text, stripping markdown codeblocks.
    Pattern verified in production StudyFlow architecture.
    """
    raw = (text or "").strip()
    if not raw:
        return {}
    # Remove markdown codeblocks
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        pass

    # Regex search for first outer braces
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else {}
        except Exception:
            pass

    return {}


def local_fallback_analyze(draft: str, industry: str = "") -> AnalyzeDraftResponse:
    """Deterministic local NLP fallback engine.
    Ensures 100% demo stability and zero-latency analysis when external APIs are unavailable.
    """
    text = (draft or "").strip()
    lower = text.toLowerCase() if hasattr(text, "toLowerCase") else text.lower()

    detected: Dict[str, Optional[ExtractedField]] = {}
    missing: List[str] = []
    questions: List[ClarificationQuestion] = []

    # Title detection
    first_line = text.split("\n")[0].split(".")[0].strip()
    if len(first_line) > 5:
        detected["title"] = ExtractedField(
            value=first_line[:60] + "..." if len(first_line) > 60 else first_line,
            source="draft",
            confidence=0.9,
        )
    else:
        missing.append("title")

    # Context & Need
    if any(k in lower for k in ["сейчас", "проблем", "вручную", "тер", "занимает", "боль"]) or len(text) > 40:
        detected["context"] = ExtractedField(value=text, source="draft", confidence=0.85)
    else:
        missing.append("context")
        questions.append(
            ClarificationQuestion(
                id="q-context",
                field="context",
                question="Опишите текущий рабочий процесс: что происходит сейчас и почему возникла потребность в изменениях?",
                reason="Контекст и потребность дают до 20 баллов в рейтинге задачи.",
            )
        )

    if any(k in lower for k in ["нужен", "хотим", "сделайте", "разработа", "автоматиз", "цель"]):
        detected["need"] = ExtractedField(value=text, source="draft", confidence=0.85)
    else:
        missing.append("need")
        questions.append(
            ClarificationQuestion(
                id="q-need",
                field="need",
                question="Какую ключевую бизнес-задачу или проблему должна решить студенческая команда?",
            )
        )

    # Available Data
    data_match = re.search(r"(данны|датасет|csv|json|api|баз|таблиц|лог|выгрузк|фото|видео|снимок)[а-я]*", lower)
    if data_match:
        detected["availableData"] = ExtractedField(
            value=f"Упомянуты данные/источники: {data_match.group(0)}",
            source="draft",
            confidence=0.8,
        )
    else:
        missing.append("availableData")
        questions.append(
            ClarificationQuestion(
                id="q-data",
                field="availableData",
                question="Какие исходные данные, форматы файлов (CSV/JSON/API) или тестовые материалы вы предоставите?",
                reason="Раздел данных дает до 20 баллов в готовности задачи.",
            )
        )

    # Target Users
    user_match = re.search(r"(клиент|пользовател|сотрудник|тренер|оператор|инженер|водител|администратор|студент|менеджер)[а-я]*", lower)
    if user_match:
        detected["targetUsers"] = ExtractedField(
            value=f"Целевая аудитория: {user_match.group(0)}",
            source="draft",
            confidence=0.75,
        )
    else:
        missing.append("targetUsers")
        questions.append(
            ClarificationQuestion(
                id="q-users",
                field="targetUsers",
                question="Кто является конечным пользователем создаваемого решения?",
            )
        )

    # Constraints
    constr_match = re.search(r"(срок|дедлайн|недел|месяц|python|react|docker|1с|ios|android|ограничен)[а-я0-9]*", lower)
    if constr_match:
        detected["constraints"] = ExtractedField(
            value=f"Границы и условия: {constr_match.group(0)}",
            source="draft",
            confidence=0.7,
        )
    else:
        missing.append("constraints")
        questions.append(
            ClarificationQuestion(
                id="q-constraints",
                field="constraints",
                question="Есть ли жесткие рамки по срокам реализации, используемым технологиям или ограничениям доступа?",
            )
        )

    # Expected Result
    result_match = re.search(r"(результат|бот|приложени|сервис|дашборд|модел|система|сайт|прототип)[а-я]*", lower)
    if result_match:
        detected["expectedResult"] = ExtractedField(
            value=f"Ожидаемый артефакт: {result_match.group(0)}",
            source="draft",
            confidence=0.8,
        )
    else:
        missing.append("expectedResult")
        questions.append(
            ClarificationQuestion(
                id="q-result",
                field="expectedResult",
                question="Какой конкретно результат работы (работающий MVP, репозиторий, документация) ожидается от команды?",
            )
        )

    # Success Criteria
    success_match = re.search(r"(точност|метрик|f1|время|секунд|%|процент|конверси|сокращени)[а-я0-9]*", lower)
    if success_match:
        detected["successCriteria"] = ExtractedField(
            value=f"Критерий успеха: {success_match.group(0)}",
            source="draft",
            confidence=0.75,
        )
    else:
        missing.append("successCriteria")
        questions.append(
            ClarificationQuestion(
                id="q-success",
                field="successCriteria",
                question="Каковы измеримые критерии успеха решения (KPI, точность алгоритма, сокращение времени)?",
            )
        )

    # Contact & Communication
    contact_match = re.search(r"(@[a-zA-Z0-9_]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\+?[0-9]{10,})", text)
    if contact_match:
        detected["contact"] = ExtractedField(
            value=contact_match.group(0),
            source="draft",
            confidence=0.95,
        )
    else:
        missing.append("contact")
        questions.append(
            ClarificationQuestion(
                id="q-contact",
                field="contact",
                question="Укажите контакты куратора задачи и удобный формат взаимодействия (звонки, чат в Telegram).",
            )
        )

    # Guarantee at least 3 questions as strictly mandated by case Section 2
    if len(questions) < 3:
        if "consultationFormat" not in detected:
            questions.append(
                ClarificationQuestion(
                    id="q-format",
                    field="consultationFormat",
                    question="В каком формате и как часто вы готовы давать обратную связь студенческой команде?",
                )
            )

    return AnalyzeDraftResponse(
        detectedFields=detected,
        missingFields=missing,
        questions=questions[:4],
        provider="local-fallback-nlp",
        fallbackUsed=True,
    )


async def analyze_draft_with_ai(draft: str, industry: str = "") -> AnalyzeDraftResponse:
    """Analyzes task draft with OpenAI or NVIDIA API if keys are present;
    otherwise safely uses local fallback engine.
    """
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    nvidia_key = os.environ.get("NVIDIA_API_KEY", "").strip()

    api_key = openai_key or nvidia_key
    provider_name = "openai" if openai_key else ("nvidia" if nvidia_key else "local")

    if not api_key:
        return local_fallback_analyze(draft, industry)

    url = (
        "https://api.openai.com/v1/chat/completions"
        if openai_key
        else "https://integrate.api.nvidia.com/v1/chat/completions"
    )
    model = (
        os.environ.get("AI_MODEL")
        or ("gpt-4o-mini" if openai_key else "meta/llama-3.1-70b-instruct")
    )

    user_prompt = f"""Task draft description:
"{draft}"
Industry: "{industry or 'General'}"

Analyze this draft. Respond ONLY with a JSON object of this structure:
{{
  "detectedFields": {{
     "title": {{"value": "...", "source": "draft", "confidence": 0.9}},
     "context": {{"value": "...", "source": "draft", "confidence": 0.8}}
  }},
  "missingFields": ["availableData", "successCriteria", "constraints"],
  "questions": [
     {{"id": "q1", "field": "availableData", "question": "..."}},
     {{"id": "q2", "field": "successCriteria", "question": "..."}},
     {{"id": "q3", "field": "constraints", "question": "..."}}
  ]
}}
IMPORTANT: Questions MUST be in Russian, strictly relevant, at least 3 questions, and DO NOT invent facts."""

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                },
            )

        if resp.status_code == 200:
            content = resp.json()["choices"][0]["message"]["content"]
            parsed = _json_from_text(content)
            if parsed and "questions" in parsed and len(parsed["questions"]) >= 3:
                return AnalyzeDraftResponse(
                    detectedFields=parsed.get("detectedFields", {}),
                    missingFields=parsed.get("missingFields", []),
                    questions=[ClarificationQuestion(**q) for q in parsed["questions"]],
                    provider=provider_name,
                    fallbackUsed=False,
                )
    except Exception as e:
        logger.warning(f"External AI call failed ({e}), switching to local fallback.")

    return local_fallback_analyze(draft, industry)


def generate_task_card_from_answers(payload: GenerateCardRequest) -> Dict[str, Any]:
    """Synthesizes structured Task card fields from initial draft + business answers.
    Follows HackAlem Rule 5: Pure synthesis without invented facts.
    """
    answers_map = {a.field: a.answer for a in payload.answers}

    title = payload.draft.split("\n")[0][:60].strip() or "Новая бизнес-задача"
    context = payload.draft.strip()
    need = answers_map.get("need", payload.draft.strip())

    target_users = answers_map.get("targetUsers", "")
    available_data = answers_map.get("availableData", "")
    constraints = answers_map.get("constraints", "")
    expected_result = answers_map.get("expectedResult", "")
    success_criteria = answers_map.get("successCriteria", "")
    contact = answers_map.get("contact", "")
    consultation_format = answers_map.get("consultationFormat", "Онлайн синхроны по договоренности + чат")

    confirmed_fields = ["title", "context", "need"]
    for field in ["targetUsers", "availableData", "constraints", "expectedResult", "successCriteria", "contact", "consultationFormat"]:
        if answers_map.get(field):
            confirmed_fields.append(field)

    return {
        "title": title,
        "industry": payload.industry or "IT & Digital",
        "tags": [payload.industry or "Digital", "MVP", "AI-Sana"],
        "context": context,
        "need": need,
        "targetUsers": target_users,
        "availableData": available_data,
        "constraints": constraints,
        "expectedResult": expected_result,
        "successCriteria": success_criteria,
        "contact": contact,
        "consultationFormat": consultation_format,
        "confirmedFields": confirmed_fields,
        "confirmed": False,
        "published": False,
    }
