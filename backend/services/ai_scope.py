"""Deterministic input rails shared with the browser; no model or network required."""

import json
import re
import unicodedata
from pathlib import Path
from typing import Iterable, Literal


POLICY_PATH = Path(__file__).resolve().parents[2] / "shared" / "aiScopePolicy.json"
POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
CANONICAL_QUESTIONS = POLICY["questions"]
INJECTION_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in POLICY["injectionPatterns"])
OFF_TOPIC_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in POLICY["offTopicPatterns"])
TOPIC_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in POLICY["topicPatterns"])
WORK_CONTEXT_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in POLICY["workContextPatterns"])
WORK_INTENT_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in POLICY["workIntentPatterns"])
INVISIBLE_CHARACTERS = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]")


class ScopeViolation(Exception):
    def __init__(self, code: Literal["OFF_TOPIC", "PROMPT_INJECTION"]):
        self.code = code
        self.message = POLICY["messages"][code]
        super().__init__(self.message)


def normalize_scope_text(text: str, preserve_clauses: bool = False) -> str:
    """Normalize only for inspection; retain the original text in extracted fields."""
    normalized = unicodedata.normalize("NFKC", text).lower()
    normalized = INVISIBLE_CHARACTERS.sub("", normalized)
    # Injection commands may span lines; only topical rules need clause boundaries.
    if preserve_clauses:
        normalized = re.sub(r"[\r\n]+", "; ", normalized)
    return " ".join(normalized.split())


def ensure_ai_scope(draft: str, industry: str = "", answers: Iterable[str] = ()) -> None:
    """Reject overrides and unrelated requests before checking the draft's domain."""
    texts = (draft, industry, *answers)
    normalized = [normalize_scope_text(text) for text in texts]
    # Check every text for overrides first, regardless of where off-topic text occurs.
    if any(pattern.search(text) for text in normalized for pattern in INJECTION_PATTERNS):
        raise ScopeViolation("PROMPT_INJECTION")
    clauses = [normalize_scope_text(text, preserve_clauses=True) for text in texts]
    if any(pattern.search(text) for text in clauses for pattern in OFF_TOPIC_PATTERNS):
        raise ScopeViolation("OFF_TOPIC")
    # Industry and answer keywords cannot turn an unrelated draft into a business task.
    # Accept everyday work descriptions without demanding software/business jargon.
    has_task_context = any(pattern.search(normalized[0]) for pattern in TOPIC_PATTERNS) or (
        any(pattern.search(normalized[0]) for pattern in WORK_CONTEXT_PATTERNS)
        and any(pattern.search(normalized[0]) for pattern in WORK_INTENT_PATTERNS)
    )
    if not has_task_context:
        raise ScopeViolation("OFF_TOPIC")
