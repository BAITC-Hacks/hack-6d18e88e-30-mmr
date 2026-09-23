import { z } from 'zod';
import { create } from 'zustand';
import type { AiDraftAnalysis, AiInspection, ClarificationQuestion, GenerateCardPayload, PromptInspectorData } from '../types/ai';
import type { Task } from '../types/task';
import { analysisSchema, analyzeRequestSchema, cardFields, generatedCardSchema, generateRequestSchema, inspectorSchema } from './aiSchemas';
import { localAnalyzeDraft, localGenerateCard } from './aiFallback';
import { AiScopeError, assertTaskScope, getClarificationQuestion, sanitizeQuestions } from './aiScope';

const BACKEND_URL = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const LOCAL_ONLY = import.meta.env?.VITE_AI_MODE === 'local';
const REQUEST_TIMEOUT_MS = 8_000;
type RequestOptions = { signal?: AbortSignal };

export const ANALYSIS_PROMPT = 'Контракт AI-клиента: извлекай только дословные фрагменты бизнес-черновика. Неизвестные поля оставляй пустыми. Модель выбирает поля для 3–4 уточнений; интерфейс использует проверенные шаблоны вопросов. Подтверждение, публикация и выбор команды доступны только человеку. Фактический prompt провайдера задаёт backend; это описание проверяемого клиентом контракта.';
export const useAiInspectorStore = create<{ latest: AiInspection | null; clear: () => void }>((set) => ({ latest: null, clear: () => set({ latest: null }) }));

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
    this.name = 'AiRequestError'; this.status = status;
  }
}

function includesExcerpt(text: string, excerpt: string): boolean {
  return text.replace(/\s+/g, ' ').trim().includes(excerpt.replace(/\s+/g, ' ').trim());
}

export function createClarificationQuestions(missingFields: string[]): ClarificationQuestion[] {
  const ordered = ['targetUsers', 'availableData', 'successCriteria', 'need', 'expectedResult', 'constraints', 'contact', 'consultationFormat', 'title', 'context'];
  const selected = ordered.filter(field => missingFields.includes(field)).slice(0, 4);
  for (const field of ordered) if (selected.length < 3 && !selected.includes(field)) selected.push(field);
  return selected.map(getClarificationQuestion);
}

interface RequestResult<T> {
  data?: T;
  response: unknown;
  validation: AiInspection['validation'];
  reason?: string;
}

/** The deadline covers headers and response body; deliberate refusals never fall back. */
async function request<T>(path: string, schema: z.ZodType<T>, payload?: unknown, options: RequestOptions = {}): Promise<RequestResult<T>> {
  if (options.signal?.aborted) throw new DOMException('Анализ отменён', 'AbortError');
  const trace: RequestResult<T> = { response: null, validation: { jsonValid: false, schemaValid: false, issues: [] } };
  if (LOCAL_ONLY) return { ...trace, reason: 'Выбран локальный режим без обращения к AI-серверу.' };
  const controller = new AbortController();
  let timedOut = false;
  let rejectedStatus: number | undefined;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${BACKEND_URL}/api/ai/${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal,
    });
    // Decide this before reading JSON: malformed or stalled refusal bodies must not enable fallback.
    if (response.status >= 400 && response.status < 500) {
      rejectedStatus = response.status;
      if (response.status === 422) {
        const error = await response.json().catch(() => undefined);
        const code = error?.detail?.code;
        if (code === 'OFF_TOPIC' || code === 'PROMPT_INJECTION') throw new AiScopeError(code);
      }
      throw new AiRequestError(response.status);
    }
    // The JSON-only branch also supports lightweight transports used by contract tests.
    if (typeof response.text === 'function') {
      const body = await response.text(); trace.response = body;
      try { trace.response = JSON.parse(body); trace.validation.jsonValid = true; }
      catch {
        if (!response.ok) throw new Error(`AI backend вернул ошибку HTTP ${response.status}.`);
        throw new Error('Backend вернул ответ, который не является JSON.');
      }
    } else { trace.response = await response.json(); trace.validation.jsonValid = true; }
    if (!response.ok) throw new Error(`AI backend вернул ошибку HTTP ${response.status}.`);
    const parsed = schema.safeParse(trace.response);
    if (!parsed.success) {
      trace.validation.issues = parsed.error.issues.map(issue => `${issue.path.join('.') || 'response'}: ${issue.message}`);
      throw new Error('Ответ AI не соответствует ожидаемой структуре.');
    }
    trace.validation.schemaValid = true;
    trace.data = parsed.data;
    return trace;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Анализ отменён', 'AbortError');
    if (error instanceof AiScopeError || error instanceof AiRequestError) throw error;
    if (rejectedStatus !== undefined) throw new AiRequestError(rejectedStatus);
    trace.reason = timedOut ? 'AI не ответил за 8 секунд.' : error instanceof TypeError ? 'Сервис AI сейчас недоступен.' : error instanceof Error ? error.message : 'Сервис AI сейчас недоступен.';
    if (!trace.validation.issues.length) trace.validation.issues.push(trace.reason);
    return trace;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

let lastRequest = 0;
export async function analyzeDraft(draft: string, industry = '', options: RequestOptions = {}): Promise<AiDraftAnalysis> {
  const payload = analyzeRequestSchema.parse({ draft, industry });
  assertTaskScope(payload.draft, payload.industry);
  const requestId = ++lastRequest;
  const started = performance.now();
  const trace = await request('analyze', analysisSchema, payload, options);
  const data = trace.data;
  let result: AiDraftAnalysis;
  if (data && Object.values(data.detectedFields).every(field => !field || (field.source === 'draft' && includesExcerpt(payload.draft, field.value)))) {
    const detectedFields = Object.fromEntries(cardFields.map(key => {
      const value = data.detectedFields[key];
      return [key, value ? { ...value, confidence: value.confidence ?? undefined } : null];
    }));
    result = {
      ...data, detectedFields, missingFields: cardFields.filter(key => !detectedFields[key]),
      questions: sanitizeQuestions(data.questions.map(question => ({ ...question, reason: question.reason ?? undefined }))),
      ...(data.fallbackUsed ? { reason: 'Сервер использовал локальное извлечение исходных фрагментов без внешней AI-модели.' } : {}),
    };
  } else {
    if (data) {
      trace.reason = 'AI вернул сведения, которые нельзя подтвердить исходным черновиком.';
      trace.validation.issues.push('Grounding: extracted values must be original draft excerpts with source=draft.');
    }
    const local = localAnalyzeDraft(payload.draft);
    // Preserve all original context for review, including facts outside the local extraction patterns.
    const detectedFields = Object.fromEntries(cardFields.map(key => [key, key === 'context' ? { value: payload.draft, source: 'draft' as const } : local.detectedFields[key] ?? null]));
    result = { ...local, detectedFields, missingFields: cardFields.filter(key => !detectedFields[key]), reason: trace.reason };
  }
  if (requestId === lastRequest && !options.signal?.aborted) useAiInspectorStore.setState({ latest: {
    prompt: ANALYSIS_PROMPT, input: payload, outputSchema: z.toJSONSchema(analysisSchema), response: trace.response,
    normalizedResponse: result, validation: trace.validation, provider: result.provider,
    fallbackUsed: result.fallbackUsed, reason: result.reason, durationMs: Math.round(performance.now() - started),
  } });
  return result;
}

export async function generateCardFromAnswers(input: GenerateCardPayload, options: RequestOptions = {}): Promise<Partial<Task>> {
  const payload = generateRequestSchema.parse(input);
  assertTaskScope(payload.draft, payload.industry, payload.answers.map(answer => answer.answer));
  let { data: card } = await request('generate-card', generatedCardSchema, payload, options);
  const suppliedText = [payload.draft, ...payload.answers.map(answer => answer.answer)];
  if (card && (card.industry !== payload.industry ||
    card.tags.some(tag => ![payload.industry, ...suppliedText].some(text => text.includes(tag))) ||
    cardFields.some(field => card![field] && !suppliedText.some(text => includesExcerpt(text, card![field]))) ||
    payload.answers.some(answer => answer.answer && payload.answers.findLast(other => other.field === answer.field && other.answer)?.answer !== card![answer.field]))) card = undefined;
  const now = new Date().toISOString();
  return { ...(card || localGenerateCard(payload)), id: `task-${crypto.randomUUID()}`, createdAt: now, updatedAt: now,
    rating: 0, readinessLevel: 'draft', confirmedFields: [], confirmed: false, published: false };
}

export async function getPromptInspectorData(options: RequestOptions = {}): Promise<PromptInspectorData> {
  const { data } = await request('inspector', inspectorSchema, undefined, options);
  if (data) return data;
  return {
    systemPrompt: 'Локальный режим: детерминированное извлечение исходных фрагментов текста. LLM не вызывается. Неизвестные поля остаются пустыми.',
    analysisPromptTemplate: 'draft + industry → поля из исходных предложений, список пропусков, 3–4 вопроса для уточнения или подтверждения.',
    cardGenerationPromptTemplate: 'draft + answers → исходные фрагменты и дословные ответы. confirmedFields=[], confirmed=false, published=false до ручного подтверждения.',
    inputJsonSchema: z.toJSONSchema(analyzeRequestSchema), outputJsonSchema: z.toJSONSchema(analysisSchema),
    safetyRules: [
      'Не добавлять факты: сохранять исходные фрагменты и ответы пользователя.',
      'Уточнения могут менять только поля содержания карточки.',
      'Подтверждение и публикация выполняются человеком.',
      'Ключи внешних AI-провайдеров хранятся только на backend.',
      'Посторонние просьбы и команды сменить роль отклоняются до вызова AI; отказ сервера не обходит локальный fallback.',
      'Текст уточняющих вопросов берётся из проверенных шаблонов по выбранным полям, а не из свободного ответа модели.',
    ],
    errorHandlingStrategy: 'Недоступность сервера, HTTP 5xx, некорректный JSON, нарушение схемы или таймаут 8 секунд → локальный режим. HTTP 4xx, OFF_TOPIC и PROMPT_INJECTION → явный отказ без fallback. Отмена пользователем не создаёт результат.',
  };
}
