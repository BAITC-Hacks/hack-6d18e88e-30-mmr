import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { authClient, AuthError } from '../src/services/authClient';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('accounts use the same-origin API proxy and HttpOnly session credentials', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/auth/login');
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), { email: 'demo@example.com', password: 'test-password' });
    return Response.json({ id: 1, email: 'demo@example.com' });
  };
  assert.equal((await authClient.login('demo@example.com', 'test-password')).email, 'demo@example.com');
});

test('account reads and preference writes retain their distinct methods', async () => {
  const calls: { url: string; method?: string; body?: BodyInit | null }[] = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), method: options?.method, body: options?.body }); return Response.json({ id: 1 }); };
  await authClient.me();
  await authClient.preferences(false);
  assert.deepEqual(calls, [
    { url: '/api/auth/me', method: 'GET', body: undefined },
    { url: '/api/auth/preferences', method: 'PATCH', body: JSON.stringify({ newsletter_opt_in: false }) },
  ]);
});

test('structured core API refusals remain visible in the account client', async () => {
  globalThis.fetch = async () => Response.json({ detail: { code: 'RATE_LIMITED', message: 'Подождите перед повторным запросом.' } }, { status: 429 });
  await assert.rejects(authClient.me(), error => error instanceof AuthError && error.status === 429 && error.message === 'Подождите перед повторным запросом.');
});
