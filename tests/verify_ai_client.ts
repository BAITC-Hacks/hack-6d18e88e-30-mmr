import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDraft, generateCardFromAnswers, getPromptInspectorData } from '../frontend/src/services/aiClient';
import { localAnalyzeDraft, localGenerateCard } from '../frontend/src/services/aiFallback';
import { analysisSchema, cardFields, generatedCardSchema, inspectorSchema } from '../frontend/src/services/aiSchemas';

const draft = 'Нужен бот для заказов';
const payload = { draft, industry: '', answers: [] };
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const respond = (body: unknown) => { globalThis.fetch = async () => Response.json(body); };

try {
  // Exhaustively filled drafts still get at least three distinct questions.
  const full = 'Сейчас менеджеры работают вручную. Хотим автоматизировать заказы клиентов. ' +
    'Есть данные CSV за 2025 год. Нужен бот на Python за 2 недели. ' +
    'Критерий приемки: точность 95%. Контакт demo@example.com. Еженедельный созвон.';
  const fullAnalysis = localAnalyzeDraft(full);
  assert.ok(fullAnalysis.questions.length >= 3);
  assert.equal(new Set(fullAnalysis.questions.map(q => q.field)).size, fullAnalysis.questions.length);
  assert.equal(fullAnalysis.detectedFields.contact?.value, 'demo@example.com');
  for (const field of Object.values(fullAnalysis.detectedFields)) {
    assert.ok(!field || full.includes(field.value), 'Extracted values must be original text, including metrics and negations');
  }
  assert.ok(analysisSchema.safeParse(fullAnalysis).success);
  const negative = localAnalyzeDraft('Нужен бот. Данных CSV пока нет.');
  assert.equal(negative.detectedFields.availableData?.value, 'Данных CSV пока нет.');
  assert.equal(localAnalyzeDraft('Нужна обработка заказов на 1С.').detectedFields.constraints?.value, 'Нужна обработка заказов на 1С.');

  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal((await analyzeDraft(draft)).fallbackUsed, true);
  const card = await generateCardFromAnswers(payload);
  assert.equal(card.consultationFormat, '');
  assert.equal(card.context, draft);
  assert.equal(card.industry, '');
  assert.deepEqual(card.tags, []);
  assert.deepEqual(card.confirmedFields, []);
  assert.equal(card.rating, 0);
  assert.equal(card.confirmed, false);
  assert.equal(card.published, false);
  assert.ok(card.id && card.createdAt && card.updatedAt);
  assert.notEqual((await generateCardFromAnswers(payload)).id, card.id);

  const answered = await generateCardFromAnswers({ ...payload, answers: [
    { field: 'title', questionId: 'q-title', answer: 'Бот для заказов' },
    { field: 'context', questionId: 'q-context', answer: 'Сейчас заказы обрабатываем вручную' },
    { field: 'availableData', questionId: 'q-data', answer: 'Первая выгрузка' },
    { field: 'availableData', questionId: 'q-data', answer: 'CSV за 2025 год, 1000 заказов' },
  ] });
  assert.equal(answered.title, 'Бот для заказов');
  assert.equal(answered.context, 'Сейчас заказы обрабатываем вручную');
  assert.equal(answered.availableData, 'CSV за 2025 год, 1000 заказов');
  assert.deepEqual(answered.confirmedFields, []);

  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('should not call'); };
  for (const field of ['published', 'confirmedFields', 'id', 'rating', '__proto__']) {
    await assert.rejects(generateCardFromAnswers({ ...payload, answers: [{ field, questionId: 'q', answer: 'true' }] }));
  }
  await assert.rejects(analyzeDraft('   '));
  assert.equal(calls, 0, 'Invalid input must fail before a network request');

  const good = { ...localAnalyzeDraft(draft), provider: 'verified-provider', fallbackUsed: false };
  respond(good);
  assert.equal((await analyzeDraft(draft)).provider, 'verified-provider');
  respond({ ...good, detectedFields: { ...good.detectedFields, title: { value: 'Нужен бот', source: 'draft' } } });
  assert.equal((await analyzeDraft('Нужен  бот для заказов')).provider, 'verified-provider');
  for (const bad of [
    { ...good, questions: ['one', 'two', 'three'] },
    { ...good, questions: [good.questions[0], good.questions[0], good.questions[0]] },
    { ...good, detectedFields: { context: { value: 'Invented facts', source: 'draft' } } },
    { ...good, detectedFields: { title: { value: draft, source: 'draft', confidence: 2 } } },
    { ...good, published: true },
    { ...good, missingFields: ['title'] },
    { ...good, missingFields: ['contact', 'contact'] },
  ]) {
    respond(bad);
    assert.equal((await analyzeDraft(draft)).fallbackUsed, true);
  }
  globalThis.fetch = async () => new Response('{broken', { status: 200 });
  assert.equal((await analyzeDraft(draft)).fallbackUsed, true);
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  assert.equal((await analyzeDraft(draft)).fallbackUsed, true);
  respond({ ...localGenerateCard(payload), published: true, rating: 100 });
  assert.equal((await generateCardFromAnswers(payload)).published, false);
  respond({ ...localGenerateCard(payload), consultationFormat: 'Ежедневные созвоны' });
  assert.equal((await generateCardFromAnswers(payload)).consultationFormat, '');

  // Drive the real AbortController deadline immediately, including during body reading.
  let cleared = 0;
  globalThis.setTimeout = ((callback: () => void) => originalSetTimeout(callback, 0)) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => { cleared++; originalClearTimeout(id); }) as typeof clearTimeout;
  let cancelledBodies = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    cancel() { cancelledBodies++; },
  }));
  assert.equal((await analyzeDraft(draft)).fallbackUsed, true);
  const inspector = await getPromptInspectorData();
  assert.ok(inspectorSchema.safeParse(inspector).success);
  assert.match(inspector.systemPrompt, /Локальный режим/);
  assert.equal((await generateCardFromAnswers(payload)).rating, 0);
  assert.equal(cleared, 3, 'All requests release their deadline timer');
  assert.equal(cancelledBodies, 3, 'Stalled response bodies are cancelled at the deadline');
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;

  // Validate actual Python endpoint responses against frontend runtime contracts.
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pythonPath = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const fixtures = JSON.parse(execFileSync(existsSync(pythonPath) ? pythonPath : 'python',
    [path.join(root, 'tests/export_ai_contracts.py')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }));
  assert.ok(analysisSchema.safeParse(fixtures.analysis).success, 'Python analysis must match Zod');
  assert.ok(generatedCardSchema.safeParse(fixtures.card).success, 'Python card must match Zod');
  for (const field of cardFields) assert.equal(localGenerateCard(payload)[field], fixtures.card[field], `Offline/server basic card: ${field}`);
  assert.ok(inspectorSchema.safeParse(fixtures.inspector).success, 'Python inspector must match Zod');
  respond({ ...fixtures.analysis, provider: 'contract-fixture', fallbackUsed: false });
  assert.equal((await analyzeDraft(draft)).provider, 'contract-fixture');
  respond(fixtures.card);
  const apiCard = await generateCardFromAnswers(payload);
  for (const [key, value] of Object.entries(fixtures.card)) assert.deepEqual(apiCard[key as keyof typeof apiCard], value);
  console.log('AI client: invalid responses, deadlines, original facts, manual confirmation and Python/TypeScript contracts passed.');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
