import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDraft, useAiInspectorStore } from '../src/services/aiClient.ts';

const realFetch = globalThis.fetch;
const draft = 'Менеджеры вручную сверяют остатки и хотят сократить время работы.';
beforeEach(() => useAiInspectorStore.getState().clear());
afterEach(() => { globalThis.fetch = realFetch; });

function reply(body: unknown, status = 200) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('valid provider fields survive validation; missing questions are safely supplemented', async () => {
  const original = { detectedFields: { context: { value: draft, source: 'draft', confidence: 0.95 } }, missingFields: ['need'], questions: [], provider: 'TestProvider', fallbackUsed: false };
  reply(original);
  const result = await analyzeDraft(draft, 'Retail');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.detectedFields.context?.value, draft);
  assert.equal(result.detectedFields.contact, null);
  assert.ok(result.missingFields.includes('contact'));
  assert.ok(result.questions.length >= 3);
  const inspection = useAiInspectorStore.getState().latest!;
  assert.deepEqual(inspection.response, original);
  assert.equal(inspection.validation.schemaValid, true);
  assert.equal(inspection.validation.jsonValid, true);
  assert.equal(inspection.normalizedResponse.questions.length, 3);
});

test('stub response uses honest local fallback without inventing business facts', async () => {
  reply({ detectedFields: {}, missingFields: [], questions: [], provider: 'stub', fallbackUsed: true });
  const result = await analyzeDraft(draft, 'Retail');
  assert.equal(result.provider, 'Local Fallback');
  assert.equal(result.fallbackUsed, true);
  assert.match(result.reason || '', /заглушки/);
  assert.equal(result.detectedFields.context?.value, draft);
  for (const [field, value] of Object.entries(result.detectedFields)) if (field !== 'context') assert.equal(value, null);
  assert.ok(result.questions.length >= 3);
  assert.equal(useAiInspectorStore.getState().latest?.validation.schemaValid, true);
});

test('malformed JSON is retained verbatim and rejected before normalization', async () => {
  globalThis.fetch = async () => new Response('<html>upstream unavailable</html>');
  const result = await analyzeDraft(draft, 'Retail');
  assert.equal(result.fallbackUsed, true);
  const inspection = useAiInspectorStore.getState().latest!;
  assert.equal(inspection.response, '<html>upstream unavailable</html>');
  assert.equal(inspection.validation.jsonValid, false);
  assert.equal(inspection.validation.schemaValid, false);
  assert.match(inspection.reason || '', /JSON/);
});

test('invalid schema is rejected, with original response and validation issues retained', async () => {
  const invalid = { detectedFields: { contact: { value: 42, source: 'imagined' } }, provider: 'Fake' };
  reply(invalid);
  const result = await analyzeDraft(draft, 'Retail');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.detectedFields.contact, null);
  const inspection = useAiInspectorStore.getState().latest!;
  assert.deepEqual(inspection.response, invalid);
  assert.equal(inspection.validation.jsonValid, true);
  assert.equal(inspection.validation.schemaValid, false);
  assert.ok(inspection.validation.issues.length > 0);
});

test('network failure leaves a useful local question flow', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const result = await analyzeDraft(draft, 'Retail');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.detectedFields.context?.value, draft);
  assert.ok(result.questions.some((question) => question.field === 'successCriteria'));
  assert.match(result.reason || '', /недоступен/);
});

test('HTTP errors trigger fallback and retain the backend payload', async () => {
  reply({ detail: 'Provider is unavailable' }, 503);
  const result = await analyzeDraft(draft, 'Retail');
  assert.equal(result.fallbackUsed, true);
  assert.match(result.reason || '', /HTTP 503/);
  assert.deepEqual(useAiInspectorStore.getState().latest?.response, { detail: 'Provider is unavailable' });
});

function pendingFetch() {
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
    else signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

test('eight-second timeout aborts the request and supplies local fallback', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  pendingFetch();
  const pending = analyzeDraft(draft, 'Retail');
  context.mock.timers.tick(8_000);
  const result = await pending;
  assert.equal(result.fallbackUsed, true);
  assert.match(result.reason || '', /8 секунд/);
});

test('user navigation cancellation never generates fallback or overwrites the inspector', async () => {
  pendingFetch();
  const controller = new AbortController();
  const pending = analyzeDraft(draft, 'Retail', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(useAiInspectorStore.getState().latest, null);
});
