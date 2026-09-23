import type { AiDraftAnalysis, GenerateCardPayload } from '../types/ai';
import type { Task } from '../types/task';
import { cardFields, type CardField } from './aiSchemas';
import { assertTaskScope, getClarificationQuestion } from './aiScope';

const questions = [
  'context', 'need', 'availableData', 'successCriteria', 'expectedResult',
  'targetUsers', 'constraints', 'contact', 'consultationFormat',
].map(getClarificationQuestion);

const patterns: Partial<Record<CardField, RegExp>> = {
  context: /(?<![\p{L}\p{N}])(сейчас|проблем|теря|вручную|занимает)/iu,
  need: /(?<![\p{L}\p{N}])(нуж[ен]|хотим|сделать|сделайте|разработ|автоматиз)/iu,
  targetUsers: /(?<![\p{L}\p{N}])(клиент|пользовател|сотрудник|тренер|оператор|инженер|водител|администратор|студент|менеджер)/iu,
  availableData: /(?<![\p{L}\p{N}])(данны|датасет|csv\b|json\b|api\b|база|базы|таблиц|логи|логов|выгрузк|фото|видео|снимок)/iu,
  constraints: /(?<![\p{L}\p{N}])(срок|дедлайн|недел|месяц|python\b|react\b|docker\b|1с(?![\p{L}\p{N}])|ios\b|android\b|ограничен)/iu,
  expectedResult: /(?<![\p{L}\p{N}])(результат|бот|чат-бот|приложени|сервис|дашборд|модел|систем|сайт|прототип|mvp\b)/iu,
  successCriteria: /(?<![\p{L}\p{N}])(точност|метрик|f1\b|секунд|процент|конверси|сокращени|критери)|\d\s*%/iu,
  consultationFormat: /(?<![\p{L}\p{N}])(созвон|консультац|обратная связь|еженедельн|ревью|чат(?!-бот))/iu,
};

/** Extract original sentences, keeping amounts, deadlines and negations intact. */
export function localAnalyzeDraft(draft: string): AiDraftAnalysis {
  assertTaskScope(draft);
  const text = draft.trim();
  const sentences = text.split(/(?<=[.!?])\s+|\r?\n+/).filter(Boolean);
  const detectedFields: AiDraftAnalysis['detectedFields'] = {};
  if (text) detectedFields.title = { value: (sentences[0] || text).slice(0, 60), source: 'draft' };
  for (const [field, pattern] of Object.entries(patterns)) {
    const sentence = sentences.find(value => pattern.test(value));
    if (sentence) detectedFields[field] = { value: sentence, source: 'draft' };
  }
  const contact = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|@[a-zA-Z0-9_]+|\+?[0-9]{10,}/)?.[0];
  if (contact) detectedFields.contact = { value: contact, source: 'draft' };
  const missingFields = cardFields.filter(field => !detectedFields[field]);
  const selected = questions.filter(q => missingFields.includes(q.field as CardField)).slice(0, 4);
  for (const question of questions) {
    if (selected.length >= 3) break;
    if (!selected.some(q => q.field === question.field)) {
      selected.push(question);
    }
  }
  return { detectedFields, missingFields, questions: selected, provider: 'local-heuristic-engine', fallbackUsed: true };
}

export function localGenerateCard(payload: GenerateCardPayload): Partial<Task> {
  assertTaskScope(payload.draft, payload.industry, payload.answers.map(answer => answer.answer));
  const analysis = localAnalyzeDraft(payload.draft);
  const content = Object.fromEntries(cardFields.map(field => [field, analysis.detectedFields[field]?.value || ''])) as Record<CardField, string>;
  // Keep the full draft available for review, including facts outside known patterns.
  content.context = payload.draft.trim();
  for (const answer of payload.answers) {
    if (cardFields.includes(answer.field as CardField) && answer.answer.trim()) {
      content[answer.field as CardField] = answer.answer.trim();
    }
  }
  return {
    ...content,
    industry: payload.industry,
    tags: payload.industry ? [payload.industry] : [],
    confirmedFields: [],
    confirmed: false,
    published: false,
    rating: 0,
    readinessLevel: 'draft',
  };
}
