import { z } from 'zod';
import { create } from 'zustand';
import type {
  AiDraftAnalysis, AiInspection, ClarificationQuestion, GenerateCardPayload, PromptInspectorData,
} from '../types/ai';
import type { Task } from '../types/task';
import {
  analysisSchema, analyzeRequestSchema, cardFields, generatedCardSchema,
  generateRequestSchema, inspectorSchema,
} from './aiSchemas';
import { isSupportedExcerpt, localAnalyzeDraft, localGenerateCard } from './aiFallback';
import { AiScopeError, assertTaskScope, getClarificationQuestion, sanitizeQuestions } from './aiScope';
import { parseStrictAiJson } from './aiJson';

const BACKEND_URL = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const LOCAL_ONLY = import.meta.env?.VITE_AI_MODE === 'local';
const REQUEST_TIMEOUT_MS = 12000;
// Covers the largest valid local extraction (up to ten excerpts of a 20k draft)
// and inspector schemas, while bounding decoded/chunked browser response bodies.
const MAX_RESPONSE_BYTES = 1024 * 1024;

export const ANALYSIS_PROMPT = 'Контракт клиента: анализировать только бизнес-задачу и требования. Извлекать только исходные факты, оставлять неизвестные поля пустыми. Ответ должен пройти строгую JSON-схему и проверку цитат. Используются 3–4 утверждённых уточняющих вопроса. Подтверждение и выбор команды выполняет бизнес. Фактический prompt провайдера задаёт backend и показывает API /api/ai/inspector.';

let lastAnalysisRequest = 0;
export const useAiInspectorStore = create<{ latest: AiInspection | null; clear: () => void }>((set) => ({
  latest: null,
  clear: () => {
    lastAnalysisRequest += 1;
    set({ latest: null });
  },
}));

/** Manual editing uses the same allowlisted questions as AI and offline analysis. */
export function createClarificationQuestions(missingFields: string[]): ClarificationQuestion[] {
  const order = [
    'targetUsers', 'availableData', 'successCriteria', 'need', 'expectedResult',
    'constraints', 'contact', 'consultationFormat', 'title', 'context',
  ];
  const selected = order.filter(field => missingFields.includes(field)).slice(0, 4);
  for (const field of order) {
    if (selected.length >= 3) break;
    if (!selected.includes(field)) selected.push(field);
  }
  return selected.map(getClarificationQuestion);
}

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

interface RequestOptions { signal?: AbortSignal }
interface RequestInspection {
  response: unknown;
  jsonValid: boolean;
  schemaValid: boolean;
  issues: string[];
  reason?: string;
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Анализ отменён', 'AbortError');
}

class AiResponseError extends Error {}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => undefined);
    throw new AiResponseError('Ответ AI превышает допустимый размер или содержит неверную длину.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  let body = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      abortIfRequested(signal);
      const { value, done } = await reader.read();
      abortIfRequested(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new AiResponseError('Ответ AI превышает допустимый размер.');
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

/** Covers headers and body; external cancellation must never become a fallback. */
async function request<T>(
  path: string, schema: z.ZodType<T>, payload?: unknown,
  options: RequestOptions = {}, inspection?: RequestInspection,
): Promise<T | undefined> {
  abortIfRequested(options.signal);
  if (LOCAL_ONLY) {
    if (inspection) inspection.reason = 'В настройках включён локальный режим анализа.';
    return undefined;
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_URL}/api/ai/${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    abortIfRequested(options.signal);
    // Access, validation and quota refusals must never reach an offline fallback.
    if (response.status >= 400 && response.status < 500) {
      if (response.status === 422) {
        // Even malformed/oversized refusal bodies must remain a refusal.
        const error = await readBoundedBody(response, controller.signal)
          .then(body => parseStrictAiJson(body) as { detail?: { code?: string } }).catch(() => undefined);
        abortIfRequested(options.signal);
        const code = error?.detail?.code;
        if (code === 'OFF_TOPIC' || code === 'PROMPT_INJECTION') throw new AiScopeError(code);
      } else {
        void response.body?.cancel().catch(() => undefined);
      }
      throw new AiRequestError(response.status);
    }

    const body = await readBoundedBody(response, controller.signal);
    abortIfRequested(options.signal);
    if (timedOut) throw new DOMException('Request deadline exceeded', 'AbortError');
    if (inspection) inspection.response = body;
    let decoded: unknown;
    try {
      decoded = parseStrictAiJson(body);
      if (inspection) {
        inspection.response = decoded;
        inspection.jsonValid = true;
      }
    } catch {
      if (inspection) inspection.reason = response.ok
        ? 'Ответ сервера не является корректным JSON.'
        : `AI backend недоступен: HTTP ${response.status}.`;
      return undefined;
    }
    if (!response.ok) {
      if (inspection) inspection.reason = `AI backend недоступен: HTTP ${response.status}.`;
      return undefined;
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      if (inspection) {
        inspection.reason = 'Ответ AI не соответствует строгой схеме.';
        inspection.issues.push(...parsed.error.issues.map(issue => `${issue.path.join('.') || 'response'}: ${issue.message}`));
      }
      return undefined;
    }
    if (inspection) inspection.schemaValid = true;
    return parsed.data;
  } catch (error) {
    abortIfRequested(options.signal);
    if (error instanceof AiScopeError || error instanceof AiRequestError) throw error;
    if (inspection) inspection.reason = timedOut
      ? 'AI не ответил за 12 секунд.'
      : error instanceof AiResponseError ? error.message : 'Сервис AI сейчас недоступен.';
    return undefined;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

function normalizedAnalysis(data: AiDraftAnalysis): AiDraftAnalysis {
  const detectedFields = Object.fromEntries(cardFields.map(field => {
    const value = data.detectedFields[field];
    return [field, value ? { ...value, confidence: value.confidence ?? undefined } : null];
  }));
  return {
    ...data,
    detectedFields,
    missingFields: cardFields.filter(field => !detectedFields[field]),
    questions: sanitizeQuestions(data.questions),
  };
}

export async function analyzeDraft(draft: string, industry = '', options: RequestOptions = {}): Promise<AiDraftAnalysis> {
  const requestId = ++lastAnalysisRequest;
  const started = performance.now();
  abortIfRequested(options.signal);
  useAiInspectorStore.setState({ latest: null });
  const payload = analyzeRequestSchema.parse({ draft, industry });
  assertTaskScope(payload.draft, payload.industry);
  const inspection: RequestInspection = { response: null, jsonValid: false, schemaValid: false, issues: [] };
  const data = await request('analyze', analysisSchema, payload, options, inspection);
  abortIfRequested(options.signal);
  const grounded = data && Object.entries(data.detectedFields).every(([name, field]) =>
    !field || (field.source === 'draft' && isSupportedExcerpt(payload.draft, field.value, name !== 'title'))
  );
  const stub = data && /^(stub|local fallback)$/i.test(data.provider);
  let result: AiDraftAnalysis;
  if (data && grounded && !stub) {
    result = normalizedAnalysis({
      ...data,
      detectedFields: Object.fromEntries(Object.entries(data.detectedFields).map(([key, value]) => [
        key, value ? { ...value, confidence: value.confidence ?? undefined } : null,
      ])),
      questions: data.questions.map(question => ({ ...question, reason: question.reason ?? undefined })),
      ...(data.fallbackUsed ? { reason: 'Сервер использовал локальный анализ; внешний AI недоступен.' } : {}),
    });
  } else {
    if (data && !grounded) inspection.reason = 'Ответ AI содержит сведения, которых нет в черновике.';
    if (stub) inspection.reason = 'Backend сообщил о режиме заглушки; используем локальный анализ.';
    const reason = inspection.reason || 'Сервис AI сейчас недоступен.';
    if (!inspection.issues.length) inspection.issues.push(reason);
    result = normalizedAnalysis({ ...localAnalyzeDraft(payload.draft), reason });
  }
  if (requestId === lastAnalysisRequest && !options.signal?.aborted) {
    useAiInspectorStore.setState({ latest: {
      prompt: ANALYSIS_PROMPT, input: payload, outputSchema: z.toJSONSchema(analysisSchema),
      response: inspection.response, normalizedResponse: result,
      validation: { jsonValid: inspection.jsonValid, schemaValid: inspection.schemaValid, issues: inspection.issues },
      provider: result.provider, fallbackUsed: result.fallbackUsed, reason: result.reason,
      durationMs: Math.round(performance.now() - started),
    } });
  }
  return result;
}

export async function generateCardFromAnswers(input: GenerateCardPayload, options: RequestOptions = {}): Promise<Partial<Task>> {
  abortIfRequested(options.signal);
  const payload = generateRequestSchema.parse(input);
  assertTaskScope(payload.draft, payload.industry, payload.answers.map(answer => answer.answer));
  let card = await request('generate-card', generatedCardSchema, payload, options);
  abortIfRequested(options.signal);
  const suppliedText = [payload.draft, ...payload.answers.map(answer => answer.answer)];
  if (card && (card.industry !== payload.industry ||
    card.tags.some(tag => ![payload.industry, ...suppliedText].some(text => text.includes(tag))) ||
    cardFields.some(field => card![field] && !suppliedText.some(text => isSupportedExcerpt(text, card![field], field !== 'title'))) ||
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

export async function getPromptInspectorSnapshot(options: RequestOptions = {}): Promise<{
  data: PromptInspectorData; source: 'server' | 'local';
}> {
  const data = await request('inspector', inspectorSchema, undefined, options);
  if (data) return { data, source: 'server' };
  return { source: 'local', data: {
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
    errorHandlingStrategy: 'Сетевая ошибка, HTTP 5xx, некорректный JSON, нарушение схемы или таймаут 12 секунд → локальный режим. HTTP 4xx и тематические отказы показываются как ошибка; отмена пользователем прерывает запрос. Inspector в локальном режиме описывает локальный алгоритм.',
  } };
}

export async function getPromptInspectorData(options: RequestOptions = {}): Promise<PromptInspectorData> {
  return (await getPromptInspectorSnapshot(options)).data;
}
