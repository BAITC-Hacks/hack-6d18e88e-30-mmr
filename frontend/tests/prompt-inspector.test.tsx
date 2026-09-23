import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  navigator: dom.window.navigator, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const { createRoot } = await import('react-dom/client');
const { PromptInspector } = await import('../src/features/prompt-inspector/PromptInspector.tsx');
const { ANALYSIS_PROMPT, useAiInspectorStore } = await import('../src/services/aiClient.ts');
const realFetch = globalThis.fetch;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let unmounted: boolean;
const configuration = {
  systemPrompt: 'Actual provider system prompt from backend', analysisPromptTemplate: 'Actual JSON template: {input_json}',
  cardGenerationPromptTemplate: 'Deterministic synthesis', inputJsonSchema: {}, outputJsonSchema: {},
  safetyRules: ['Human confirmation required'], errorHandlingStrategy: 'Validation then fallback',
};
beforeEach(() => {
  useAiInspectorStore.getState().clear();
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host); unmounted = false;
});
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount());
  host.remove(); globalThis.fetch = realFetch;
});
after(() => dom.window.close());
async function render() { await act(async () => root.render(<PromptInspector />)); }
async function tab(name: string) {
  const element = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent === name);
  assert.ok(element);
  await act(async () => element.click());
}

test('real backend prompt is visible without previous analysis and separate from client contract', async () => {
  const urls: string[] = [];
  globalThis.fetch = async url => { urls.push(String(url)); return Response.json(configuration); };
  await render();
  assert.deepEqual(urls, ['/api/ai/inspector']);
  assert.match(host.textContent || '', /Prompt и схема получены с сервера/);
  assert.match(host.querySelector('pre')?.textContent || '', /Actual provider system prompt/);
  assert.match(host.textContent || '', /Пока нет завершённого анализа/);
  await tab('Контракт клиента');
  assert.equal(host.querySelector('pre')?.textContent, ANALYSIS_PROMPT);
  await tab('Input');
  assert.match(host.querySelector('pre')?.textContent || '', /Сначала завершите анализ/);
});

test('offline inspector honestly labels local rules rather than a provider prompt', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await render();
  assert.match(host.textContent || '', /Описание локального алгоритма/);
  assert.match(host.querySelector('pre')?.textContent || '', /LLM не вызывается/);
  assert.doesNotMatch(host.textContent || '', /Prompt и схема получены с сервера/);
});

test('inspector tabs support arrows, Home and End with one keyboard tab stop', async () => {
  globalThis.fetch = async () => Response.json(configuration);
  await render();
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  tabs[0].focus();
  for (const [key, expected] of [['ArrowRight', 1], ['End', 5], ['ArrowRight', 0], ['ArrowLeft', 5], ['Home', 0]] as const) {
    await act(async () => { document.activeElement?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })); });
    assert.equal(document.activeElement, tabs[expected]);
    assert.equal(tabs[expected].getAttribute('aria-selected'), 'true');
    assert.equal(tabs.filter(item => item.tabIndex === 0).length, 1);
  }
});

test('403 inspector refusal is shown once without fallback, retry or private body display', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('private-server-error', { status: 403 }); };
  await render();
  assert.equal(calls, 1);
  assert.match(host.querySelector('[role="alert"]')?.textContent || '', /запрещён/);
  assert.doesNotMatch(host.textContent || '', /private-server-error|Описание локального алгоритма/);
});

test('leaving inspector cancels an unfinished request', async () => {
  let cancelled = false;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { cancelled = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  await render();
  assert.match(host.textContent || '', /Загружаем описание/);
  await act(async () => root.unmount()); unmounted = true;
  assert.equal(cancelled, true);
});

test('inspector displays received and normalized results separately as inert text', async () => {
  useAiInspectorStore.setState({ latest: {
    prompt: ANALYSIS_PROMPT, input: { draft: 'Нужен бот', industry: '' }, outputSchema: {},
    response: '<script>bad()</script>', normalizedResponse: { detectedFields: {}, missingFields: [], questions: [], provider: 'local', fallbackUsed: true },
    validation: { jsonValid: false, schemaValid: false, issues: ['Invalid JSON'] }, provider: 'local', fallbackUsed: true, durationMs: 10,
  } });
  globalThis.fetch = async () => Response.json(configuration);
  await render();
  await tab('Latest Response');
  const output = JSON.parse(host.querySelector('pre')!.textContent!);
  assert.equal(output.received, '<script>bad()</script>');
  assert.equal(output.used.provider, 'local');
  assert.equal(host.querySelector('script'), null);
  await tab('Validation');
  assert.match(host.querySelector('pre')?.textContent || '', /Invalid JSON/);
});
