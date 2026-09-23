import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, StrictMode } from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/' });
const window = dom.window;
for (const [key, value] of Object.entries({
  window, document: window.document, navigator: window.navigator, localStorage: window.localStorage,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
  Event: window.Event, MouseEvent: window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

const { createRoot } = await import('react-dom/client');
const { TaskBuilder } = await import('../src/features/builder/TaskBuilder.tsx');
const { useAppStore } = await import('../src/app/store.ts');
const { createEmptyTask } = await import('../src/data/syntheticData.ts');
const { resetBuilderSessions } = await import('../src/features/builder/builderSessions.ts');
const { createClarificationQuestions } = await import('../src/services/aiClient.ts');
const originalFetch = globalThis.fetch;
const originalDraft = 'У нас магазин. Нужен прогноз спроса. Есть CSV с 1200 продажами. Срок — 3 недели. Контакт shop@example.com.';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const currentTask = () => useAppStore.getState().tasks.find(task => task.id === useAppStore.getState().activeTaskId)!;

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim().startsWith(text));
  assert.ok(found, `Expected a button starting with ${text}.`);
  return found;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function setText(id: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  assert.ok(field, `Expected field ${id}.`);
  const prototype = field.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function showDraft() {
  const step = host.querySelector<HTMLButtonElement>('.builder-stepper button');
  assert.ok(step);
  await click(step);
}

beforeEach(async () => {
  window.localStorage.clear(); resetBuilderSessions();
  useAppStore.getState().resetDemo();
  useAppStore.getState().addTask(createEmptyTask(originalDraft));
  // Exercise the real local extractor through the normal unavailable-backend path.
  globalThis.fetch = async () => new Response('', { status: 503 });
  host = window.document.createElement('div'); window.document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<StrictMode><TaskBuilder /></StrictMode>); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove(); globalThis.fetch = originalFetch;
});
after(() => window.close());

test('replacing a draft removes old extracted facts before analysis and keeps the new result after reopening', async () => {
  await click(button('Проанализировать с AI'));
  assert.match(currentTask().availableData, /1200/);
  assert.match(currentTask().constraints, /3 недели/);
  assert.equal(currentTask().contact, 'shop@example.com');

  await showDraft();
  await setText('draft-input', 'Нужен сайт для школы');
  for (const key of ['availableData', 'constraints', 'contact'] as const) {
    assert.equal(currentTask()[key], '', `${key} must not remain from the previous draft.`);
  }
  await click(button('Проанализировать с AI'));
  assert.equal(currentTask().context, 'Нужен сайт для школы');
  assert.equal(currentTask().expectedResult, 'Нужен сайт для школы');
  assert.ok(host.querySelector('#answer-availableData'), 'New questions include the missing data field.');
  await click(button('Повторить AI-анализ'));
  assert.equal(currentTask().contact, '');

  await act(async () => { root.unmount(); });
  root = createRoot(host);
  await act(async () => { root.render(<TaskBuilder />); });
  assert.ok(host.querySelector('#answer-availableData'), 'The restored session uses the current draft questions.');
  await click(button('Продолжить к карточке'));
  assert.equal(host.querySelector<HTMLTextAreaElement>('#task-field-context')?.value, 'Нужен сайт для школы');
  assert.equal(host.querySelector<HTMLTextAreaElement>('#task-field-availableData')?.value, '');
  assert.equal(host.querySelector<HTMLInputElement>('#task-field-contact')?.value, '');
});

test('reanalysis replaces extracted fields even when the next analysis omits them', async () => {
  await click(button('Проанализировать с AI'));
  assert.ok(currentTask().availableData);
  globalThis.fetch = async () => new Response(JSON.stringify({
    detectedFields: { context: { value: originalDraft, source: 'draft' } },
    missingFields: [], questions: createClarificationQuestions(['availableData', 'constraints', 'contact']),
    provider: 'regression-fixture', fallbackUsed: false,
  }));
  await click(button('Повторить AI-анализ'));
  assert.equal(currentTask().availableData, '', 'An omitted extraction replaces an old draft value with unknown.');
  assert.equal(currentTask().constraints, '');
  assert.equal(currentTask().contact, '');
  assert.equal(currentTask().context, originalDraft);
  assert.ok(host.querySelector('#answer-availableData'), 'Questions use the merged card, not a stale response list.');
});

test('manual corrections, deliberate blanks and clarification answers survive repeated analysis and draft edits', async () => {
  await click(button('Проанализировать с AI'));
  await setText('answer-successCriteria', 'Сократить время подготовки отчёта на 20%.');
  await click(button('Продолжить к карточке'));
  await setText('task-field-contact', 'owner@example.com');
  await setText('task-field-constraints', '');
  await showDraft();
  await click(button('Проанализировать с AI'));
  assert.equal(currentTask().contact, 'owner@example.com');
  assert.equal(currentTask().constraints, '', 'An intentionally cleared manual field must not be refilled by AI.');
  assert.equal(currentTask().successCriteria, 'Сократить время подготовки отчёта на 20%.');

  await showDraft();
  await setText('draft-input', 'Нужен сайт для школы');
  await click(button('Проанализировать с AI'));
  assert.equal(currentTask().availableData, '');
  assert.equal(currentTask().contact, 'owner@example.com');
  assert.equal(currentTask().constraints, '');
  assert.equal(currentTask().successCriteria, 'Сократить время подготовки отчёта на 20%.');
  assert.equal(currentTask().fieldSources?.contact, 'manual');
  assert.equal(currentTask().fieldSources?.successCriteria, 'clarification');
});
