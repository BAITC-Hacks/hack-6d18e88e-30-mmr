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
  await typeInto(field, value);
}
async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
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

test('editing the draft discards outdated extracted facts and preserves deliberate business answers, including cleared fields', async () => {
  await clickDemo(1);
  await setText('draft-input', 'Нужен сервис учёта заказов. Есть CSV продаж. Срок 2 недели. Контакт manager@example.com.');
  await clickDemo(2);
  assert.match(demoTask().availableData, /CSV/);
  assert.match(demoTask().constraints, /2 недели/);
  assert.equal(demoTask().contact, 'manager@example.com');
  await setText('answer-successCriteria', 'Сократить обработку заказа до 2 минут.');
  await click(button('Продолжить к карточке'));
  await setText('task-field-expectedResult', 'Проверенный бизнесом пилот в одном магазине.');
  await setText('task-field-contact', '');
  await click(host.querySelectorAll<HTMLButtonElement>('.builder-stepper button')[0]);
  await setText('draft-input', 'Нужен сервис учёта заказов. Контакт manager@example.com.');
  assert.equal(demoTask().availableData, '', 'Deleting a source fact invalidates its derived card field immediately.');
  assert.equal(demoTask().constraints, '');
  assert.equal(demoTask().fieldSources?.availableData, undefined);
  await click(button('Проанализировать с AI'));
  assert.equal(demoTask().availableData, '');
  assert.equal(demoTask().constraints, '');
  assert.equal(demoTask().expectedResult, 'Проверенный бизнесом пилот в одном магазине.');
  assert.equal(demoTask().fieldSources?.expectedResult, 'manual');
  assert.equal(demoTask().successCriteria, 'Сократить обработку заказа до 2 минут.');
  assert.equal(demoTask().fieldSources?.successCriteria, 'clarification');
  assert.equal(demoTask().contact, '', 'AI must not refill a field intentionally cleared by business.');
  assert.equal(demoTask().fieldSources?.contact, 'manual');
  assert.equal(demoTask().confirmed, false);
  assert.equal(demoTask().published, false);
});

for (const entry of ['row', 'details'] as const) test(`published task editing from ${entry} keeps its identity and requires fresh confirmation and publication`, async () => {
  const task = current().tasks.find(item => item.published)!;
  const originalIds = current().tasks.map(item => item.id);
  const originalProposals = structuredClone(current().proposals);
  await click(button('Мои задачи', host.querySelector('.sidebar')!));
  const row = [...host.querySelectorAll<HTMLElement>('.business-task-row')].find(item => item.textContent?.includes(task.title))!;
  assert.ok(row);
  let scope: ParentNode = row;
  if (entry === 'details') {
    await click(row.querySelector<HTMLButtonElement>('.task-title-button')!);
    scope = host.querySelector('dialog[open]')!;
  }
  await click(button('Редактировать карточку', scope));
  assert.equal(current().page, 'builder');
  assert.equal(current().activeTaskId, task.id);
  assert.equal(host.querySelector('dialog[open]'), null);
  assert.deepEqual(current().tasks.map(item => item.id), originalIds);
  assert.equal(current().tasks.find(item => item.id === task.id)?.published, true, 'Opening the editor does not revoke publication.');
  await setText('task-field-successCriteria', 'Сократить время обработки заказа до 3 минут.');
  const changed = () => current().tasks.find(item => item.id === task.id)!;
  assert.equal(changed().confirmed, false);
  assert.equal(changed().published, false);
  assert.equal(changed().fieldSources?.successCriteria, 'manual');
  assert.equal(changed().confirmedFields.includes('successCriteria'), false);
  assert.deepEqual(current().proposals, originalProposals);
  await click(button('Проверить готовность'));
  assert.equal(button('Подтвердить карточку').disabled, true);
  await click(host.querySelector<HTMLInputElement>('.consent-field input')!);
  await click(button('Подтвердить карточку'));
  assert.equal(changed().confirmed, true);
  assert.equal(changed().published, false);
  await click(button('Перейти к публикации'));
  await click(button('Опубликовать задачу'));
  assert.equal(changed().published, true);
  assert.deepEqual(current().tasks.map(item => item.id), originalIds);
});

test('a team can send another deliberate proposal for the same task without duplicate submission', async () => {
  await clickDemo(6);
  const taskId = current().activeTaskId!;
  const teamId = current().activeTeamId!;
  const initialCount = current().proposals.filter(item => item.taskId === taskId && item.teamId === teamId).length;
  let dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  await click(button('Заполнить пример', dialog));
  const submit = button('Отправить предложение', dialog);
  await act(async () => { submit.click(); submit.click(); });
  assert.equal(current().proposals.filter(item => item.taskId === taskId && item.teamId === teamId).length, initialCount + 1);
  const task = current().tasks.find(item => item.id === taskId)!;
  const card = [...host.querySelectorAll<HTMLElement>('.task-card')].find(item => item.textContent?.includes(task.title))!;
  await click(button('Подробнее', card));
  dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  assert.ok(button('Перейти к моему отклику', dialog));
  await click(button('Отправить предложение', dialog));
  dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  await click(button('Заполнить пример', dialog));
  await click(button('Отправить предложение', dialog));
  const own = current().proposals.filter(item => item.taskId === taskId && item.teamId === teamId);
  assert.equal(own.length, initialCount + 2);
  assert.equal(new Set(own.map(item => item.id)).size, own.length);
  assert.ok(own.every(item => item.status === 'pending'));
});

test('repeating the proposal demo keeps the chosen task and starts a fresh form', async () => {
  await clickDemo(6);
  const taskId = current().activeTaskId;
  const teamId = current().activeTeamId;
  const before = current().proposals.filter(item => item.taskId === taskId && item.teamId === teamId).length;
  const dialog = host.querySelector('dialog[open]')!;
  await click(button('Заполнить пример', dialog));
  await click(button('Отправить предложение', dialog));
  await clickDemo(6);
  // The second click replays the same step on the next animation frame.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.equal(current().activeTaskId, taskId);
  assert.equal(current().activeTeamId, teamId);
  const repeated = host.querySelector('dialog[open]')!;
  assert.ok(repeated?.querySelector('form'));
  assert.equal(repeated.querySelector('textarea')?.value, '');
  assert.equal(current().proposals.filter(item => item.taskId === taskId && item.teamId === teamId).length, before + 1);
});

test('repeating the AI demo step after editing the draft runs analysis for the changed text', async () => {
  await clickDemo(1);
  await clickDemo(2);
  await click(host.querySelectorAll<HTMLButtonElement>('.builder-stepper button')[0]);
  const updated = 'Нужен бот для записи клиентов в пекарне. Сейчас заявки теряются вручную.';
  await setText('draft-input', updated);
  await clickDemo(2);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(host.querySelector('.clarification-question'), 'Replaying the active step actually opens its UI.');
  assert.equal(useAiInspectorStore.getState().latest?.input.draft, updated);
  assert.match(demoTask().need, /бот для записи/);
  assert.equal(demoTask().confirmed, false);
});

test('business selects multiple teams in comparison and rejects another proposal without altering earlier choices', async () => {
  await act(async () => { current().setActiveTask('task-retail'); });
  await click(button('Отклики', host.querySelector('.sidebar')!));
  const candidates = current().proposals.filter(item => item.taskId === 'task-retail');
  assert.equal(candidates.length, 2);
  const untouched = new Map(current().proposals.filter(item => item.taskId !== 'task-retail').map(item => [item.id, item.status]));
  await click(button('Сравнить предложения'));
  let dialog = host.querySelector('dialog[open]')!;
  await click(button('Выбрать команду', dialog));
  await click(button('Выбрать команду', dialog));
  assert.ok(candidates.every(proposal => current().proposals.find(item => item.id === proposal.id)?.status === 'selected'));
  for (const proposal of candidates) assert.equal(current().milestones.filter(item => item.taskId === proposal.taskId && item.teamId === proposal.teamId).length, 4);
  for (const [id, status] of untouched) assert.equal(current().proposals.find(item => item.id === id)?.status, status);
  await click(button('Закрыть сравнение', dialog));
  await choose(host.querySelector<HTMLSelectElement>('.proposals-toolbar select')!, 'task-healthcare');
  const declined = current().proposals.find(item => item.taskId === 'task-healthcare')!;
  await click(button('Отклонить предложение', host.querySelector('.business-proposal')!));
  dialog = host.querySelector('dialog[open]')!;
  await click(button('Отмена', dialog));
  assert.equal(current().proposals.find(item => item.id === declined.id)?.status, 'pending');
  await click(button('Отклонить предложение', host.querySelector('.business-proposal')!));
  await click(button('Отклонить предложение', host.querySelector('dialog[open]')!));
  assert.equal(current().proposals.find(item => item.id === declined.id)?.status, 'rejected');
  assert.ok(candidates.every(proposal => current().proposals.find(item => item.id === proposal.id)?.status === 'selected'));
});

test('catalog filters can recover from zero results and details cancellation restores focus', async () => {
  await click(button('Студент', host.querySelector('.role-switch')!));
  await click(button('Каталог задач', host.querySelector('.sidebar')!));
  const publishedCount = current().tasks.filter(item => item.published).length;
  const search = host.querySelector<HTMLInputElement>('.catalog-toolbar input')!;
  await typeInto(search, 'несуществующий-проект-123456');
  assert.equal(host.querySelectorAll('.task-card').length, 0);
  assert.match(host.textContent || '', /Пока ничего не нашлось/);
  await click(button('Сбросить фильтры'));
  assert.equal(search.value, '');
  assert.equal(host.querySelectorAll('.task-card').length, publishedCount);
  const industry = host.querySelectorAll<HTMLSelectElement>('.catalog-toolbar select')[0];
  await choose(industry, 'Retail');
  assert.ok([...host.querySelectorAll('.task-card .task-industry')].every(item => item.textContent?.startsWith('Retail')));
  const opener = button('Подробнее', host.querySelector('.task-card')!);
  opener.focus();
  await click(opener);
  const dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  assert.equal(window.document.body.style.overflow, 'hidden');
  await act(async () => { dialog.dispatchEvent(new window.Event('cancel', { cancelable: true })); });
  assert.equal(host.querySelector('dialog[open]'), null);
  assert.equal(window.document.body.style.overflow, '');
  assert.equal(window.document.activeElement, opener);
});

test('tag editing accepts separators while saving only unique nonempty labels', async () => {
  await clickDemo(1);
  await click(button('Заполнить самостоятельно'));
  const input = window.document.getElementById('task-tags') as HTMLInputElement;
  input.focus();
  await typeInto(input, 'Python,');
  assert.equal(input.value, 'Python,', 'Typing a separator remains possible.');
  assert.deepEqual(demoTask().tags, ['Python']);
  await typeInto(input, 'Python, React, Python, , React  ');
  assert.deepEqual(demoTask().tags, ['Python', 'React']);
  await act(async () => { input.blur(); });
  assert.equal(input.value, 'Python, React');
});

test('proposal form rejects unsafe URLs and changing team never submits under another identity', async () => {
  await clickDemo(6);
  const before = current().proposals.length;
  const dialog = host.querySelector('dialog[open]')!;
  await click(button('Заполнить пример', dialog));
  const url = dialog.querySelector<HTMLInputElement>('input[type="url"]')!;
  await typeInto(url, 'javascript:alert(1)');
  await click(button('Отправить предложение', dialog));
  assert.equal(current().proposals.length, before);
  assert.match(dialog.querySelector('[role="alert"]')?.textContent || '', /https|http/);
  await typeInto(url, 'https://user:password@example.com/prototype');
  await click(button('Отправить предложение', dialog));
  assert.equal(current().proposals.length, before);
  assert.ok(dialog.querySelector('[role="alert"]'));
  await typeInto(url, '');
  const originalTeam = current().activeTeamId;
  await act(async () => { current().setActiveTeam(current().teams.find(team => team.id !== originalTeam)!.id); });
  assert.equal(button('Отправить предложение', dialog).disabled, true);
  assert.match(dialog.textContent || '', /Активная команда изменилась/);
  await click(button('Отмена', dialog));
  assert.equal(current().proposals.length, before);
});
