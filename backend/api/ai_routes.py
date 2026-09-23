from fastapi import APIRouter
from schemas.ai import (
    AnalyzeDraftRequest,
    AnalyzeDraftResponse,
    GenerateCardRequest,
    PromptInspectorResponse,
)
from services.ai_engine import (
    analyze_draft_with_ai,
    generate_task_card_from_answers,
    SYSTEM_PROMPT,
)

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/analyze", response_model=AnalyzeDraftResponse)
async def analyze_draft(payload: AnalyzeDraftRequest):
    """Analyzes task draft, detects present fields, and generates at least 3 relevant questions."""
    return await analyze_draft_with_ai(payload.draft, payload.industry or "")


@router.post("/generate-card")
async def generate_card(payload: GenerateCardRequest):
    """Generates structured editable task card from draft and user answers."""
    return generate_task_card_from_answers(payload)


@router.get("/inspector", response_model=PromptInspectorResponse)
async def get_prompt_inspector():
    """Provides transparency data for jury review: prompts, schemas, safety rules, fallback."""
    return PromptInspectorResponse(
        systemPrompt=SYSTEM_PROMPT,
        analysisPromptTemplate="Draft: {draft} | Industry: {industry} -> JSON Analysis",
        cardGenerationPromptTemplate="Draft + Answers -> 9-field confirmed Task Card",
        inputJsonSchema={
            "type": "object",
            "properties": {
                "draft": {"type": "string", "minLength": 5},
                "industry": {"type": "string"},
            },
            "required": ["draft"],
        },
        outputJsonSchema={
            "type": "object",
            "properties": {
                "detectedFields": {"type": "object"},
                "missingFields": {"type": "array"},
                "questions": {"type": "array", "minItems": 3},
                "provider": {"type": "string"},
                "fallbackUsed": {"type": "boolean"},
            },
            "required": ["detectedFields", "missingFields", "questions", "provider", "fallbackUsed"],
        },
        safetyRules=[
          "ИИ не добавляет факты, которых не сообщал пользователь (Section 5 кейса).",
          "API-ключи и чувствительные данные изолированы в .env на сервере.",
          "Все сгенерированные поля редактируются и вручную подтверждаются человеком перед публикацией.",
        ],
        errorHandlingStrategy="Dual-tier architecture: External LLM -> regex json recovery (_json_from_text) -> deterministic NLP fallback.",
    )
