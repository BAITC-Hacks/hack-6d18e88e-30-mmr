import { z } from 'zod';
import type { AiDraftAnalysis, GenerateCardPayload, PromptInspectorData } from '../types/ai';
import type { Task } from '../types/task';
import {
  analysisSchema, analyzeRequestSchema, cardFields, generatedCardSchema,
  generateRequestSchema, inspectorSchema,
} from './aiSchemas';
import { localAnalyzeDraft, localGenerateCard } from './aiFallback';
import { AiScopeError, assertTaskScope, sanitizeQuestions } from './aiScope';

const BACKEND_URL = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const LOCAL_ONLY = import.meta.env?.VITE_AI_MODE === 'local';
const REQUEST_TIMEOUT_MS = 12000;

export class AiRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    const messages: Record<number, string> = {
      400: 'Запрос отклонён. Проверьте введённые данные.',
      401: 'Для доступа к AI требуется авторизация на сервере.',
      403: 'Доступ к AI с этого адреса запрещён.',
      413: 'Запрос слишком большой. Сократите текст.',
      415: 'Сервер не поддерживает формат запроса.',
      422: 'Проверьте поля запроса и допустимую длину текста.',
      429: 'Слишком много запросов. Подождите и повторите попытку.',
    };
    super(messages[status] || 'Сервер отклонил запрос. Проверьте настройки подключения.');
    this.name = 'AiRequestError';
    this.status = status;
  }
}

function includesExcerpt(text: string, excerpt: string): boolean {
  return text.replace(/\s+/g, ' ').trim().includes(excerpt.replace(/\s+/g, ' ').trim());
}

/** The deadline covers both response headers and the JSON body. */
async function request<T>(path: string, schema: z.ZodType<T>, payload?: unknown): Promise<T | undefined> {
  if (LOCAL_ONLY) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_URL}/api/ai/${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 422) {
        const error = await response.json().catch(() => undefined);
        const code = error?.detail?.code;
        if (code === 'OFF_TOPIC' || code === 'PROMPT_INJECTION') throw new AiScopeError(code);
      }
      if (response.status >= 400 && response.status < 500) throw new AiRequestError(response.status);
      return undefined;
    }
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    // A deliberate policy refusal is not a network failure: never bypass it locally.
    if (error instanceof AiScopeError || error instanceof AiRequestError) throw error;
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeDraft(draft: string, industry = ''): Promise<AiDraftAnalysis> {
  const payload = analyzeRequestSchema.parse({ draft, industry });
  assertTaskScope(payload.draft, payload.industry);
  const data = await request('analyze', analysisSchema, payload);
  if (data && Object.values(data.detectedFields).every(field =>
    !field || (field.source === 'draft' && includesExcerpt(payload.draft, field.value))
  )) {
    return {
      ...data,
      detectedFields: Object.fromEntries(Object.entries(data.detectedFields).map(([key, value]) => [
        key, value ? { ...value, confidence: value.confidence ?? undefined } : null,
      ])),
      questions: sanitizeQuestions(data.questions.map(question => ({ ...question, reason: question.reason ?? undefined }))),
    };
  }
  return localAnalyzeDraft(payload.draft);
}

export async function generateCardFromAnswers(input: GenerateCardPayload): Promise<Partial<Task>> {
  const payload = generateRequestSchema.parse(input);
  assertTaskScope(payload.draft, payload.industry, payload.answers.map(answer => answer.answer));
  let card = await request('generate-card', generatedCardSchema, payload);
  const suppliedText = [payload.draft, ...payload.answers.map(answer => answer.answer)];
  if (card && (card.industry !== payload.industry ||
    card.tags.some(tag => ![payload.industry, ...suppliedText].some(text => text.includes(tag))) ||
    cardFields.some(field => card![field] && !suppliedText.some(text => includesExcerpt(text, card![field]))) ||
    payload.answers.some(answer => answer.answer &&
      payload.answers.findLast(other => other.field === answer.field && other.answer)?.answer !== card![answer.field]))) {
    card = undefined;
  }
  const now = new Date().toISOString();
  return {
    ...(card || localGenerateCard(payload)),
    id: `task-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    rating: 0,
    readinessLevel: 'draft',
    confirmedFields: [],
    confirmed: false,
    published: false,
  };
}

export async function getPromptInspectorData(): Promise<PromptInspectorData> {
  const data = await request('inspector', inspectorSchema);
  if (data) return data;
  return {
    systemPrompt: 'Локальный режим: детерминированное извлечение исходных фрагментов текста. LLM не вызывается. Неизвестные поля остаются пустыми.',
    analysisPromptTemplate: 'draft + industry → поля из исходных предложений, список пропусков, 3–4 вопроса для уточнения или подтверждения.',
    cardGenerationPromptTemplate: 'draft + answers → исходные фрагменты и дословные ответы. confirmedFields=[], confirmed=false, published=false до ручного подтверждения.',
    inputJsonSchema: z.toJSONSchema(analyzeRequestSchema),
    outputJsonSchema: z.toJSONSchema(analysisSchema),
    safetyRules: [
      'Не добавлять факты: сохранять исходные фрагменты и ответы пользователя.',
      'Уточнения могут менять только поля содержания карточки.',
      'Подтверждение и публикация выполняются человеком.',
      'Ключи внешних AI-провайдеров хранятся только на backend.',
      'Посторонние просьбы и команды сменить роль отклоняются до вызова AI; отказ сервера не обходит локальный fallback.',
      'Текст уточняющих вопросов берётся из проверенных шаблонов по выбранным полям, а не из свободного ответа модели.',
    ],
    errorHandlingStrategy: 'HTTP-ошибка, некорректный JSON, нарушение схемы или таймаут 12 секунд → локальный режим. Inspector в локальном режиме описывает локальный алгоритм.',
  };
}
