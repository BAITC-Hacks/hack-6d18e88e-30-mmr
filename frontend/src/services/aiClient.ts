import { z } from 'zod';
import { create } from 'zustand';
import type { AiDraftAnalysis, AiInspection, ClarificationQuestion } from '../types/ai';

const fieldNames = ['title', 'context', 'need', 'targetUsers', 'availableData', 'constraints', 'expectedResult', 'successCriteria', 'contact', 'consultationFormat'] as const;
const fieldSchema = z.enum(fieldNames);
const analysisSchema = z.object({
  detectedFields: z.partialRecord(fieldSchema, z.object({
    value: z.string(),
    source: z.enum(['draft', 'clarification', 'manual']),
    confidence: z.number().min(0).max(1).optional(),
  }).nullable()),
  missingFields: z.array(fieldSchema),
  questions: z.array(z.object({ id: z.string().min(1), field: fieldSchema, question: z.string().min(8) })),
  provider: z.string().min(1),
  fallbackUsed: z.boolean(),
});

export const ANALYSIS_PROMPT = 'Ожидаемое поведение AI: структурируй бизнес-черновик по схеме. Извлекай только явно указанные факты. Не выдумывай пользователей, данные, контакты, сроки или метрики. Неизвестные поля оставляй null. Задай минимум три конкретных уточняющих вопроса. Подтверждать карточку и выбирать команду может только бизнес. Это описание контракта клиента; фактический prompt провайдера задаёт backend.';

const outputSchema = z.toJSONSchema(analysisSchema);

export const useAiInspectorStore = create<{ latest: AiInspection | null; clear: () => void }>((set) => ({
  latest: null,
  clear: () => set({ latest: null }),
}));

const questionText: Record<(typeof fieldNames)[number], string> = {
  title: 'Как коротко назвать задачу, чтобы команда поняла её цель?',
  context: 'Как сейчас устроен процесс и в чём возникает проблема?',
  need: 'Какую конкретную проблему должен решить проект?',
  targetUsers: 'Кто будет пользоваться решением и какие действия им нужно выполнять?',
  availableData: 'Какие данные вы передадите команде: формат, объём, период и способ доступа?',
  constraints: 'Какие есть ограничения по срокам, технологиям, бюджету и доступу к данным?',
  expectedResult: 'Что команда должна передать в конце: прототип, отчёт, модель или работающий сервис?',
  successCriteria: 'Как вы измерите успех: какая метрика, исходное значение и целевой результат?',
  contact: 'Кто со стороны бизнеса отвечает на вопросы команды и как с ним связаться?',
  consultationFormat: 'Как часто и в каком формате бизнес готов консультировать команду?',
};

export function createClarificationQuestions(missingFields: string[]): ClarificationQuestion[] {
  const ordered = ['targetUsers', 'availableData', 'successCriteria', 'need', 'expectedResult', 'constraints', 'contact', 'consultationFormat', 'title', 'context'];
  const selected = ordered.filter((field) => missingFields.includes(field));
  for (const field of ordered) if (selected.length < 3 && !selected.includes(field)) selected.push(field);
  return selected.map((field) => ({ id: `clarify-${field}`, field, question: questionText[field as keyof typeof questionText] }));
}

let lastRequest = 0;

export async function analyzeDraft(draft: string, industry: string, options: { signal?: AbortSignal } = {}): Promise<AiDraftAnalysis> {
  const request = ++lastRequest;
  const started = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8_000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let rawResponse: unknown = null;
  let jsonValid = false;
  let schemaValid = false;
  const issues: string[] = [];
  let result: AiDraftAnalysis;
  try {
    const baseUrl = (import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/ai/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft, industry }), signal: controller.signal,
    });
    const body = await response.text();
    rawResponse = body;
    try { rawResponse = JSON.parse(body); jsonValid = true; } catch { throw new Error('Backend вернул ответ, который не является JSON.'); }
    if (!response.ok) throw new Error(`AI backend вернул ошибку HTTP ${response.status}.`);
    const parsed = analysisSchema.safeParse(rawResponse);
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`));
      throw new Error('Ответ AI не соответствует ожидаемой структуре.');
    }
    schemaValid = true;
    if (parsed.data.fallbackUsed || /^(stub|local fallback)$/i.test(parsed.data.provider)) throw new Error('Backend работает в режиме заглушки; внешняя AI-модель недоступна.');
    if (!Object.values(parsed.data.detectedFields).some((field) => field?.value.trim())) throw new Error('AI не вернул заполненных полей.');
    const detectedFields = Object.fromEntries(fieldNames.map((field) => [field, parsed.data.detectedFields[field] ?? null]));
    const missingFields = fieldNames.filter((field) => !detectedFields[field]?.value.trim());
    const questions: ClarificationQuestion[] = parsed.data.questions.filter((question, index, all) => all.findIndex((item) => item.field === question.field) === index);
    for (const question of createClarificationQuestions(missingFields)) {
      if (questions.length >= 3) break;
      if (!questions.some((item) => item.field === question.field)) questions.push(question);
    }
    result = { detectedFields, missingFields, questions, provider: parsed.data.provider, fallbackUsed: false };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Анализ отменён', 'AbortError');
    const reason = timedOut ? 'AI не ответил за 8 секунд.' : error instanceof TypeError ? 'Сервис AI сейчас недоступен.' : error instanceof Error ? error.message : 'Сервис AI сейчас недоступен.';
    if (!issues.length && !schemaValid) issues.push(reason);
    const missingFields = fieldNames.filter((field) => field !== 'context' || !draft.trim());
    result = {
      detectedFields: Object.fromEntries(fieldNames.map((field) => [field, field === 'context' && draft.trim() ? { value: draft.trim(), source: 'draft' as const } : null])),
      missingFields, questions: createClarificationQuestions(missingFields),
      provider: 'Local Fallback', fallbackUsed: true, reason,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
  if (request === lastRequest && !options.signal?.aborted) useAiInspectorStore.setState({ latest: {
    prompt: ANALYSIS_PROMPT, input: { draft, industry }, outputSchema,
    response: rawResponse, normalizedResponse: result, validation: { jsonValid, schemaValid, issues },
    provider: result.provider, fallbackUsed: result.fallbackUsed, reason: result.reason,
    durationMs: Math.round(performance.now() - started),
  } });
  return result;
}
