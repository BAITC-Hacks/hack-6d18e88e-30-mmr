import assert from 'node:assert/strict';
import { AiRequestError, analyzeDraft, generateCardFromAnswers } from '../frontend/src/services/aiClient';

const originalFetch = globalThis.fetch;
try {
  for (const status of [400, 401, 403, 413, 415, 422, 429]) {
    globalThis.fetch = async () => new Response('untrusted-private-server-content', { status });
    for (const call of [() => analyzeDraft('Нужен бот'), () => generateCardFromAnswers({ draft: 'Нужен бот', industry: '', answers: [] })]) {
      await assert.rejects(call, (error: unknown) => error instanceof AiRequestError && error.status === status && !error.message.includes('private'));
    }
  }
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must validate before network'); };
  await assert.rejects(analyzeDraft('Нужен бот\ud800'));
  await assert.rejects(analyzeDraft('Нужен бот\u0000'));
  await assert.rejects(generateCardFromAnswers({ draft: 'Нужен бот', industry: '', answers:
    Array.from({ length: 6 }, (_, index) => ({ questionId: `q-${index}`, field: 'constraints', answer: 'x'.repeat(10000) })),
  }));
  assert.equal(calls, 0);
  console.log('AI boundary: no fallback bypass for access/rate/validation errors; bounded text and safe Unicode passed.');
} finally {
  globalThis.fetch = originalFetch;
}
