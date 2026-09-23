from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


class ExtractedField(BaseModel):
    value: str
    source: str = "draft"
    confidence: Optional[float] = None


class ClarificationQuestion(BaseModel):
    id: str
    field: str
    question: str
    reason: Optional[str] = None


class AnalyzeDraftRequest(BaseModel):
    draft: str = Field(..., min_length=5, description="Initial business draft description")
    industry: Optional[str] = ""


class AnalyzeDraftResponse(BaseModel):
    detectedFields: Dict[str, Optional[ExtractedField]]
    missingFields: List[str]
    questions: List[ClarificationQuestion]
    provider: str
    fallbackUsed: bool


class ClarificationAnswer(BaseModel):
    questionId: str
    field: str
    answer: str


class GenerateCardRequest(BaseModel):
    draft: str
    industry: Optional[str] = ""
    answers: List[ClarificationAnswer] = []


class PromptInspectorResponse(BaseModel):
    systemPrompt: str
    analysisPromptTemplate: str
    cardGenerationPromptTemplate: str
    inputJsonSchema: Dict[str, Any]
    outputJsonSchema: Dict[str, Any]
    safetyRules: List[str]
    errorHandlingStrategy: str
