from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/ai", tags=["AI"])


class AnalyzeDraftRequest(BaseModel):
    draft: str
    industry: str = ""


@router.post("/analyze")
async def analyze_draft(payload: AnalyzeDraftRequest):
    return {
        "detectedFields": {},
        "missingFields": [],
        "questions": [],
        "provider": "stub",
        "fallbackUsed": True,
    }
