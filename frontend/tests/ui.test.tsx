import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, StrictMode } from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/' });
const window = dom.window;
for (const [key, value] of Object.entries({
  window, document: window.document, navigator: window.navigator, localStorage: window.localStorage,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLDialogElement: window.HTMLDialogElement, Event: window.Event, MouseEvent: window.MouseEvent,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
window.HTMLElement.prototype.scrollIntoView = function () {};
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

// React DOM and Zustand must observe a complete browser-like environment at import time.
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App.tsx');
const { useAppStore } = await import('../src/app/store.ts');
const { resetBuilderSessions } = await import('../src/features/builder/builderSessions.ts');
const { useAiInspectorStore } = await import('../src/services/aiClient.ts');
const { TASK_FIELDS } = await import('../src/app/constants.ts');
const { STORAGE_KEY } = await import('../src/services/storageService.ts');
const { calculateRating } = await import('../src/services/ratingService.ts');
const { seedTasks } = await import('../src/data/syntheticData.ts');
const realFetch = globalThis.fetch;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const current = () => useAppStore.getState();
const demoTask = () => current().tasks.find(task => task.id === 'demo-task')!;
const stub = { detectedFields: {}, missingFields: [], questions: [], provider: 'stub', fallbackUsed: true };

function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim().startsWith(text));
  assert.ok(found, `Expected a visible button starting with “${text}”.`);
  return found;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function clickDemo(step: number) {
  const element = host.querySelectorAll<HTMLButtonElement>('.demo-step')[step - 1];
  assert.ok(element, `Demo step ${step} is available.`);
  await click(element);
}
async function setText(id: string, value: string) {
  const field = window.document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  assert.ok(field, `Field ${id} exists.`);
  const prototype = field.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  window.localStorage.clear(); resetBuilderSessions(); useAiInspectorStore.getState().clear(); current().resetDemo();
  globalThis.fetch = async () => new Response(JSON.stringify(stub));
  host = window.document.createElement('div'); window.document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<StrictMode><App /></StrictMode>); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove(); globalThis.fetch = realFetch;
});
after(() => window.close());

test('full business UI: demo draft → AI fallback → answers → live rating → consent → publication', async () => {
  await clickDemo(1);
  assert.equal(current().page, 'builder');
  assert.match((window.document.getElementById('draft-input') as HTMLTextAreaElement).value, /прогнозировать спрос/);
  assert.equal(demoTask().confirmed, false);
  assert.equal(demoTask().published, false);
  const startingPotential = calculateRating(demoTask()).potentialTotal;

  let resolveRequest!: (response: Response) => void;
  globalThis.fetch = async () => new Promise<Response>(resolve => { resolveRequest = resolve; });
  await clickDemo(2);
  assert.equal(button('Анализируем задачу').disabled, true);
  assert.equal(button('Заполнить самостоятельно').disabled, true);
  await act(async () => { resolveRequest(new Response(JSON.stringify(stub))); });
  assert.match(host.textContent || '', /Локальный режим уточнения/);
  assert.ok(host.querySelectorAll('.clarification-question').length >= 3);
  assert.equal(demoTask().need, demoTask().rawDraft, 'Fallback preserves explicit facts from the draft.');
  assert.equal(demoTask().context, '', 'Fallback does not invent the current business process.');
  assert.equal(demoTask().availableData, '');
  assert.equal(useAiInspectorStore.getState().latest?.fallbackUsed, true);

  await clickDemo(3);
  await click(button('Заполнить примерные ответы'));
  assert.ok(calculateRating(demoTask()).potentialTotal > startingPotential + 40);
  assert.equal(demoTask().rating, 0, 'Draft facts earn points only after business confirmation.');
  assert.equal(demoTask().fieldSources?.availableData, 'clarification');
  assert.equal(demoTask().confirmed, false, 'Demo answers never confirm business facts automatically.');
  assert.equal(demoTask().published, false);
  assert.match(host.textContent || '', /синтетические ответы/);
  await click(button('Продолжить к карточке'));
  for (const { key } of TASK_FIELDS) assert.ok(window.document.getElementById(`task-field-${key}`));
  assert.equal(host.querySelectorAll('.rating-category').length, 7);

  const completePotential = calculateRating(demoTask()).potentialTotal;
  const criterion = demoTask().successCriteria;
  await setText('task-field-successCriteria', '');
  assert.ok(calculateRating(demoTask()).potentialTotal < completePotential, 'Potential immediately reflects a cleared success metric.');
  assert.match(host.querySelector('.rating-improvements')?.textContent || '', /измеримые критерии/);
  await setText('task-field-successCriteria', criterion);
  assert.equal(calculateRating(demoTask()).potentialTotal, completePotential);
  assert.equal(demoTask().fieldSources?.successCriteria, 'manual');

  await click(button('Проверить готовность'));
  assert.equal(button('Подтвердить карточку').disabled, true);
  const checkbox = host.querySelector<HTMLInputElement>('.consent-field input')!;
  await click(checkbox);
  assert.equal(button('Подтвердить карточку').disabled, false);
  await click(button('Подтвердить карточку'));
  assert.equal(demoTask().confirmed, true);
  assert.equal(demoTask().rating, completePotential);
  assert.equal(demoTask().published, false, 'Confirmation and publication are separate actions.');
  await click(button('Перейти к публикации'));
  await click(button('Опубликовать задачу'));
  assert.equal(demoTask().published, true);
  assert.match(host.textContent || '', /Задача открыта для команд/);
  const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
  assert.equal(persisted.state.tasks.find((task: { id: string }) => task.id === 'demo-task').published, true);
  await click(button('Открыть каталог'));
  assert.equal(current().page, 'catalog');
  assert.match(host.textContent || '', /Прогнозирование спроса в магазинах/);
});

test('leaving the builder cancels analysis and never overwrites the task or inspector', async () => {
  let aborted = false;
  globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  await clickDemo(1);
  const original = { ...demoTask() };
  await clickDemo(2);
  await click(button('Мои задачи', host.querySelector('.sidebar')!));
  assert.equal(current().page, 'tasks');
  assert.equal(aborted, true);
  assert.equal(demoTask().context, original.context);
  assert.equal(demoTask().need, original.need);
  assert.equal(useAiInspectorStore.getState().latest, null);
});

test('student proposal → business choice → one-time milestone points → student status', async () => {
  const originalProposalIds = new Set(current().proposals.map(proposal => proposal.id));
  await clickDemo(6);
  assert.equal(current().activeRole, 'student');
  const teamId = current().activeTeamId!;
  const proposalDialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  assert.ok(proposalDialog, 'Demo step 6 opens the proposal form.');
  await click(button('Заполнить пример', proposalDialog));
  const fields = [...proposalDialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input')];
  assert.ok(fields.filter(field => field.required).every(field => field.value.trim()), 'Example fills all required proposal fields.');
  await click(button('Отправить предложение', proposalDialog));
  const submitted = current().proposals.find(proposal => !originalProposalIds.has(proposal.id))!;
  assert.ok(submitted);
  assert.equal(submitted.teamId, teamId);
  assert.equal(submitted.status, 'pending');
  assert.equal(host.querySelector('dialog[open]'), null);
  const otherStatuses = new Map(current().proposals.filter(proposal => proposal.id !== submitted.id).map(proposal => [proposal.id, proposal.status]));

  await clickDemo(7);
  assert.equal(current().activeRole, 'business');
  assert.equal(current().activeTaskId, submitted.taskId, 'Demo preserves the task when changing roles.');
  const businessProposal = [...host.querySelectorAll<HTMLElement>('.business-proposal')].find(item => item.textContent?.includes(submitted.idea));
  assert.ok(businessProposal, 'The submitted proposal is visible to business.');
  await click(button('Выбрать команду', businessProposal));
  assert.equal(current().proposals.find(proposal => proposal.id === submitted.id)?.status, 'selected');
  for (const [id, status] of otherStatuses) assert.equal(current().proposals.find(proposal => proposal.id === id)?.status, status, 'Other teams keep their statuses.');
  const milestones = current().milestones.filter(milestone => milestone.taskId === submitted.taskId && milestone.teamId === teamId);
  assert.equal(milestones.length, 4);
  const initialPoints = current().teams.find(team => team.id === teamId)!.progressPoints;
  await clickDemo(8);
  const teamName = current().teams.find(team => team.id === teamId)!.name;
  const project = [...host.querySelectorAll<HTMLElement>('section.panel')].find(item => item.querySelector(':scope > .eyebrow')?.textContent === teamName);
  assert.ok(project, 'The selected team has its own project milestones.');
  const prototypeRow = [...project.querySelectorAll<HTMLElement>('.milestone-list li')].find(item => item.querySelector('h4')?.textContent === 'Prototype')!;
  assert.ok(prototypeRow);
  await click(button('Подтвердить этап', prototypeRow));
  assert.equal(current().teams.find(team => team.id === teamId)!.progressPoints, initialPoints + 10);
  assert.equal(prototypeRow.querySelector('button'), null, 'A completed milestone no longer offers confirmation.');
  assert.match(prototypeRow.textContent || '', /10 баллов начислено/);
  const beforeReturn = current().teams.find(team => team.id === teamId)!.progressPoints;
  await clickDemo(7); await clickDemo(8);
  assert.equal(current().teams.find(team => team.id === teamId)!.progressPoints, beforeReturn, 'Reopening the milestone does not grant duplicate points.');

  await click(button('Студент', host.querySelector('.role-switch')!));
  await click(button('Мои отклики', host.querySelector('.sidebar')!));
  const ownProposal = [...host.querySelectorAll<HTMLElement>('.proposal-card')].find(item => item.textContent?.includes(submitted.idea));
  assert.ok(ownProposal);
  assert.match(ownProposal.textContent || '', /Выбрано бизнесом/);
  assert.match(ownProposal.textContent || '', /10 баллов начислено/);
  assert.equal([...ownProposal.querySelectorAll('button')].some(item => item.textContent?.includes('Подтвердить этап')), false, 'Student sees milestone progress without business controls.');
});

test('demo reset requires its dialog confirmation and cancel preserves user work', async () => {
  const initialMilestoneCount = current().milestones.length;
  await clickDemo(1);
  await setText('draft-input', 'Наш новый черновик должен сохраниться при отмене сброса.');
  const savedId = demoTask().id;
  const savedDraft = demoTask().rawDraft;
  await click(button('Сброс', host.querySelector('.demo-bar')!));
  let resetDialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  assert.ok(resetDialog);
  await click(button('Отмена', resetDialog));
  assert.equal(current().tasks.find(task => task.id === savedId)?.rawDraft, savedDraft);
  await click(button('Сброс', host.querySelector('.demo-bar')!));
  resetDialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  await click(button('Сбросить данные', resetDialog));
  assert.equal(current().tasks.length, seedTasks.length);
  assert.equal(current().tasks.some(task => task.id === savedId), false);
  assert.equal(current().milestones.length, initialMilestoneCount);
  assert.equal(current().page, 'overview');
  assert.equal(useAiInspectorStore.getState().latest, null);
});
