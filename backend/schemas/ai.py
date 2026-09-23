from typing import Annotated, Any, Dict, List, Literal, Optional, get_args

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator


TaskField = Literal[
    "title", "context", "need", "targetUsers", "availableData", "constraints",
    "expectedResult", "successCriteria", "contact", "consultationFormat",
]
TASK_FIELDS = get_args(TaskField)
def valid_text(value: str) -> str:
    try:
        value.encode('utf-8')
    except UnicodeError as error:
        raise ValueError('Invalid Unicode text') from error
    if any(ord(char) < 32 and char not in '\r\n\t' for char in value):
        raise ValueError('Unsupported control characters')
    return value


SafeText = Annotated[str, AfterValidator(valid_text)]
NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000), AfterValidator(valid_text)]
IdentifierText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), AfterValidator(valid_text)]
DraftText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=20000), AfterValidator(valid_text)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ExtractedField(StrictModel):
    value: NonEmptyText
    source: Literal["draft", "clarification", "manual"] = "draft"
    confidence: Optional[float] = Field(default=None, ge=0, le=1, allow_inf_nan=False)


class ClarificationQuestion(StrictModel):
    id: IdentifierText
    field: TaskField
    question: NonEmptyText = Field(max_length=1000)
    reason: Optional[NonEmptyText] = Field(default=None, max_length=1000)


class AnalyzeDraftRequest(StrictModel):
    draft: DraftText
    industry: Optional[SafeText] = Field(default="", max_length=200)


class DraftAnalysis(StrictModel):
    """The model's output, before trusted server metadata is added."""

    detectedFields: Dict[TaskField, Optional[ExtractedField]]
    missingFields: List[TaskField] = Field(max_length=10)
    questions: List[ClarificationQuestion] = Field(min_length=3, max_length=4)

    @model_validator(mode="after")
    def validate_consistency(self):
        if len(self.missingFields) != len(set(self.missingFields)):
            raise ValueError("missingFields must be unique")
        if any(self.detectedFields.get(field) is not None for field in self.missingFields):
            raise ValueError("A field cannot be both detected and missing")
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError("Question IDs must be unique")
        if len({question.field for question in self.questions}) != len(self.questions):
            raise ValueError("Questions must cover distinct fields")
        return self


class AnalyzeDraftResponse(DraftAnalysis):
    provider: NonEmptyText = Field(max_length=100)
    fallbackUsed: bool


class ClarificationAnswer(StrictModel):
    questionId: IdentifierText
    field: TaskField
    answer: SafeText = Field(max_length=10000)


class GenerateCardRequest(AnalyzeDraftRequest):
    answers: List[ClarificationAnswer] = Field(default_factory=list, max_length=30)

    @model_validator(mode='after')
    def bounded_total_text(self):
        total = len(self.draft) + len(self.industry or '') + sum(len(answer.answer) for answer in self.answers)
        if total > 50000:
            raise ValueError('Combined text limit exceeded')
        return self


class PromptInspectorResponse(StrictModel):
    systemPrompt: str
    analysisPromptTemplate: str
    cardGenerationPromptTemplate: str
    inputJsonSchema: Dict[str, Any]
    outputJsonSchema: Dict[str, Any]
    safetyRules: List[str]
    errorHandlingStrategy: str
