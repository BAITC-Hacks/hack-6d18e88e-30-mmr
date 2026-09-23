import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App.tsx');
const { useAppStore } = await import('../src/app/store.ts');
const { resetBuilderSessions } = await import('../src/features/builder/builderSessions.ts');
const { demoAnswers, seedProposals, seedTasks } = await import('../src/data/syntheticData.ts');
const { calculateRating, calculateRatingPreview } = await import('../src/services/ratingService.ts');
const { STORAGE_KEY } = await import('../src/services/storageService.ts');
const current = () => useAppStore.getState();
const logistics = () => current().tasks.find(task => task.id === 'task-logistics')!;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim().startsWith(text));
  assert.ok(found, `Expected button starting with “${text}”.`);
  return found;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function setText(id: string, value: string) {
  const field = window.document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  assert.ok(field, `Field ${id} exists.`);
  const prototype = field.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
function taskRow(title: string) {
  const row = [...host.querySelectorAll<HTMLElement>('.business-task-row')].find(item => item.querySelector('h3')?.textContent === title);
  assert.ok(row, `Business task “${title}” exists.`);
  return row;
}
function catalogPosition(title: string) {
  return [...host.querySelectorAll('.task-card h2')].findIndex(item => item.textContent === title);
}

beforeEach(async () => {
  window.localStorage.clear(); resetBuilderSessions(); current().resetDemo();
  host = window.document.createElement('div'); window.document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<StrictMode><App /></StrictMode>); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });
after(() => window.close());

test('published task can be reopened, improved, confirmed again and move up in the real catalog UI', async () => {
  const title = logistics().title;
  const initialRating = logistics().rating;
  const originalTaskCount = current().tasks.length;
  const proposalIds = current().proposals.filter(proposal => proposal.taskId === logistics().id).map(proposal => proposal.id);
  await click(button('Студент', host.querySelector('.role-switch')!));
  const initialPosition = catalogPosition(title);
  assert.ok(initialPosition > 0, 'The incomplete published task starts below better documented tasks.');

  await click(button('Бизнес', host.querySelector('.role-switch')!));
  await click(button('Мои задачи', host.querySelector('.sidebar')!));
  await click(button('Редактировать карточку', taskRow(title)));
  assert.equal(current().page, 'builder');
  assert.equal(current().activeTaskId, 'task-logistics');
  assert.ok(window.document.getElementById('task-field-availableData'), 'Edit opens the card fields immediately.');
  assert.equal(logistics().published, true, 'Opening the editor alone does not withdraw publication.');
  assert.equal(logistics().confirmed, true);
  await setText('task-field-availableData', 'Предоставим обезличенную CSV выгрузку адресов, координат и интервалов доставки за 6 месяцев.');
  assert.equal(logistics().published, false, 'Changing content withdraws the old publication.');
  assert.equal(logistics().confirmed, false);
  assert.deepEqual(logistics().confirmedFields, []);
  assert.equal(logistics().rating, 0, 'Unconfirmed content does not earn a catalog rating.');

  await setText('task-field-context', 'Служба доставки обрабатывает 200 заказов в день. Диспетчеры строят маршруты вручную и не успевают учитывать новые заказы.');
  await setText('task-field-need', 'Оптимизировать маршруты курьеров с учётом вместимости машины и согласованных интервалов доставки.');
  await setText('task-field-targetUsers', 'Три диспетчера ежедневно составляют маршруты для 20 курьеров и проверяют новые заказы.');
  await setText('task-field-constraints', 'Прототип нужен за 3 недели, бюджет до 200 000 тенге. Обезличенные данные на внутреннем сервере.');
  await setText('task-field-expectedResult', 'Работающий прототип панели диспетчера с маршрутами, временем прибытия и выгрузкой плана в CSV.');
  await setText('task-field-successCriteria', 'Снизить средний пробег на 15% и доставлять не менее 95% заказов в согласованный интервал.');
  await setText('task-field-consultationFormat', demoAnswers.consultationFormat);
  await click(button('Проверить готовность'));
  assert.equal(button('Подтвердить карточку').disabled, true);
  await click(host.querySelector<HTMLInputElement>('.consent-field input')!);
  await click(button('Подтвердить карточку'));
  assert.equal(logistics().confirmed, true);
  assert.ok(logistics().rating > initialRating);
  assert.equal(logistics().published, false, 'Confirmation still requires an explicit publication step.');
  await click(button('Перейти к публикации'));
  await click(button('Опубликовать задачу'));
  assert.equal(logistics().published, true);
  assert.equal(current().tasks.length, originalTaskCount, 'Editing updates the existing task instead of creating a copy.');
  assert.deepEqual(current().proposals.filter(proposal => proposal.taskId === logistics().id).map(proposal => proposal.id), proposalIds, 'Existing proposals remain attached.');
  const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
  const saved = persisted.state.tasks.find((task: { id: string }) => task.id === 'task-logistics');
  assert.equal(saved.published, true);
  assert.equal(saved.rating, logistics().rating);

  await click(button('Открыть каталог'));
  assert.ok(catalogPosition(title) >= 0 && catalogPosition(title) < initialPosition, 'The improved published task moves up under the default rating sort.');
});

test('business task details provide an edit action while student details remain read-only', async () => {
  const title = logistics().title;
  await click(button('Мои задачи', host.querySelector('.sidebar')!));
  await click(button(title, taskRow(title)));
  let dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  assert.ok(dialog);
  await click(button('Редактировать карточку', dialog));
  assert.equal(current().page, 'builder');
  assert.ok(window.document.getElementById('task-field-title'));
  assert.equal(host.querySelector('dialog[open]'), null);

  await click(button('Студент', host.querySelector('.role-switch')!));
  await click(button(title));
  dialog = host.querySelector<HTMLDialogElement>('dialog[open]')!;
  assert.ok(dialog);
  assert.equal([...dialog.querySelectorAll('button')].some(item => item.textContent?.includes('Редактировать карточку')), false);
  assert.ok(button('Отправить предложение', dialog));
});

test('all six synthetic proposals link to corresponding local teaching prototypes and seed scores follow confirmation', async () => {
  assert.ok(seedProposals.length >= 5);
  const html = await readFile(new URL('../public/demo-prototypes.html', import.meta.url), 'utf8');
  const prototypes = new JSDOM(html);
  try {
    assert.match(prototypes.window.document.body.textContent || '', /Команды, предложения, данные и показатели.*синтетические/s);
    for (const proposal of seedProposals) {
      const url = new URL(proposal.prototypeUrl);
      assert.match(url.protocol, /^https?:$/);
      assert.equal(url.origin, window.location.origin);
      assert.equal(url.pathname, '/demo-prototypes.html');
      const section = prototypes.window.document.getElementById(url.hash.slice(1));
      assert.ok(section, `Prototype section exists for ${proposal.id}.`);
      assert.ok(section.querySelector('table, .queue'), 'Every proposal links to a visible mock result.');
      assert.match(section.textContent || '', /СИНТЕТИЧЕСКАЯ КОМАНДА/);
    }
    assert.equal(new Set(seedProposals.map(proposal => proposal.prototypeUrl)).size, seedProposals.length);
    for (const task of seedTasks) {
      assert.equal(task.rating, calculateRating(task).total);
      if (task.confirmed) assert.ok(task.rating > 0 && task.confirmedFields.length > 0);
      else {
        assert.equal(task.rating, 0);
        assert.ok(calculateRatingPreview(task).total > 0, 'Drafts retain an independent preview score.');
      }
    }
  } finally { prototypes.window.close(); }
});
