import type { AiDraftAnalysis, GenerateCardPayload } from '../types/ai';
import type { Task } from '../types/task';
import { cardFields, type CardField } from './aiSchemas';
import { assertTaskScope, getClarificationQuestion } from './aiScope';
import fallbackPolicy from '../../../shared/aiFallbackPolicy.json';

const retiredContactPattern = new RegExp(fallbackPolicy.retiredContactPattern, 'iu');
const phoneLabelPattern = new RegExp(fallbackPolicy.phoneLabelPattern, 'iu');
const negationPattern = new RegExp(fallbackPolicy.negationPattern, 'iu');

/** Short positive excerpts remain valid; preserve the clause around a negation. */
export function isSupportedExcerpt(text: string, excerpt: string, preserveContext = true): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const quoted = normalize(excerpt);
  if (!normalize(text).includes(quoted)) return false;
  if (!preserveContext) return true;
  const containing = text.split(/(?<=[.!?])\s+|[\n;]+/).map(normalize).filter(part => part.includes(quoted));
  const withoutPunctuation = (value: string) => value.replace(/[.!?]+$/, '');
  return !containing.length || containing.some(part => !negationPattern.test(part) ||
    withoutPunctuation(part) === withoutPunctuation(quoted));
}

function extractContact(sentences: string[]): string | undefined {
  for (const sentence of sentences) {
    // Marker words inside an address/handle are data, e.g. old@example.com.
    const surroundingText = sentence.replace(new RegExp(fallbackPolicy.contactPattern, 'giu'), ' ');
    if (retiredContactPattern.test(surroundingText)) continue;
    for (const match of sentence.matchAll(new RegExp(fallbackPolicy.contactPattern, 'giu'))) {
      const value = match[0];
      // A long order/account number alone is not evidence of a phone contact.
      if (value.includes('@') || value.startsWith('+') || phoneLabelPattern.test(sentence)) return value;
    }
  }
  return undefined;
}

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
  const sentences = text.split(/(?<=[.!?])\s+|[\n;]+/).map(value => value.trim()).filter(Boolean);
  const detectedFields: AiDraftAnalysis['detectedFields'] = {};
  if (text) detectedFields.title = { value: (sentences[0] || text).slice(0, 60), source: 'draft' };
  for (const [field, pattern] of Object.entries(patterns)) {
    const sentence = sentences.find(value => pattern.test(value));
    if (sentence) detectedFields[field] = { value: sentence, source: 'draft' };
  }
  const contact = extractContact(sentences);
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
