import policy from '../../../shared/aiScopePolicy.json';
import type { ClarificationQuestion } from '../types/ai';

export type AiScopeCode = keyof typeof policy.messages;

export class AiScopeError extends Error {
  readonly code: AiScopeCode;

  constructor(code: AiScopeCode) {
    super(policy.messages[code]);
    this.name = 'AiScopeError';
    this.code = code;
  }
}

const injectionPatterns = policy.injectionPatterns.map(pattern => new RegExp(pattern, 'iu'));
const offTopicPatterns = policy.offTopicPatterns.map(pattern => new RegExp(pattern, 'iu'));
const topicPatterns = policy.topicPatterns.map(pattern => new RegExp(pattern, 'iu'));
const workContextPatterns = policy.workContextPatterns.map(pattern => new RegExp(pattern, 'iu'));
const workIntentPatterns = policy.workIntentPatterns.map(pattern => new RegExp(pattern, 'iu'));

function normalize(text: string, preserveClauses = false): string {
  const normalized = text.normalize('NFKC').toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
  return (preserveClauses ? normalized.replace(/[\r\n]+/g, '; ') : normalized)
    .replace(/\s+/g, ' ').trim();
}

/** Short clarification answers inherit scope from the draft, never from industry. */
export function assertTaskScope(draft: string, industry = '', answers: string[] = []): void {
  const input = [draft, industry, ...answers];
  const texts = input.map(text => normalize(text));
  if (texts.some(text => injectionPatterns.some(pattern => pattern.test(text)))) {
    throw new AiScopeError('PROMPT_INJECTION');
  }
  // Plain descriptions need not use software/business jargon. Combine a real work
  // context with a problem or intended change; industry/answers cannot supply it.
  const hasTaskContext = topicPatterns.some(pattern => pattern.test(texts[0])) ||
    (workContextPatterns.some(pattern => pattern.test(texts[0])) &&
      workIntentPatterns.some(pattern => pattern.test(texts[0])));
  if (input.some(text => offTopicPatterns.some(pattern => pattern.test(normalize(text, true)))) || !hasTaskContext) {
    throw new AiScopeError('OFF_TOPIC');
  }
}

/** AI selects fields; the UI receives only reviewed clarification text and IDs. */
export function getClarificationQuestion(field: string): ClarificationQuestion {
  if (!Object.hasOwn(policy.questions, field)) throw new AiScopeError('OFF_TOPIC');
  return {
    id: `q-${field}`,
    field,
    question: policy.questions[field as keyof typeof policy.questions],
  };
}

export function sanitizeQuestions(questions: ClarificationQuestion[]): ClarificationQuestion[] {
  return questions.map(({ field }) => getClarificationQuestion(field));
}
