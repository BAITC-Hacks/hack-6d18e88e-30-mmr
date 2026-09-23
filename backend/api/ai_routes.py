from fastapi import APIRouter, HTTPException
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
    ANALYSIS_PROMPT_TEMPLATE,
    CARD_GENERATION_DESCRIPTION,
)
from services.ai_scope import ScopeViolation

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/analyze", response_model=AnalyzeDraftResponse, response_model_exclude_none=True)
async def analyze_draft(payload: AnalyzeDraftRequest):
    """Analyzes task draft, detects present fields, and generates at least 3 relevant questions."""
    try:
        return await analyze_draft_with_ai(payload.draft, payload.industry or "")
    except ScopeViolation as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": error.message}) from error


@router.post("/generate-card")
async def generate_card(payload: GenerateCardRequest):
    """Generates structured editable task card from draft and user answers."""
    try:
        return generate_task_card_from_answers(payload)
    except ScopeViolation as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": error.message}) from error


@router.get("/inspector", response_model=PromptInspectorResponse)
async def get_prompt_inspector():
    """Provides transparency data for jury review: prompts, schemas, safety rules, fallback."""
    return PromptInspectorResponse(
        systemPrompt=SYSTEM_PROMPT,
        analysisPromptTemplate=ANALYSIS_PROMPT_TEMPLATE,
        cardGenerationPromptTemplate=CARD_GENERATION_DESCRIPTION,
        inputJsonSchema=AnalyzeDraftRequest.model_json_schema(),
        outputJsonSchema=AnalyzeDraftResponse.model_json_schema(),
        safetyRules=[
          "ИИ не добавляет факты, которых не сообщал пользователь (Section 5 кейса).",
          "API-ключи хранятся на сервере; внешний AI получает текст черновика только при настроенном ключе.",
          "Все сгенерированные поля редактируются и вручную подтверждаются человеком перед публикацией.",
          "Обрабатываются только описания бизнес-задач и требования; посторонние запросы и команды сменить роль отклоняются до вызова AI.",
          "Модель выбирает поля для уточнения; текст вопросов берётся только из общего каталога утверждённых шаблонов.",
        ],
        errorHandlingStrategy="Input rail: shared deterministic policy checks draft, industry and answers (Unicode NFKC normalization); OFF_TOPIC or PROMPT_INJECTION returns HTTP 422 before any provider or fallback call. Allowed inputs: External LLM (3-second total deadline) -> strict JSON/Pydantic validation and draft-excerpt checks -> canonical question templates with no free-form reasons. Deterministic local fallback on timeout, HTTP errors or invalid output uses the same scope policy and canonical questions. Optional single JSON code fence is accepted; duplicate keys, non-finite numbers and unknown fields are rejected. Pattern-based input checks are not a complete semantic classifier.",
    )
