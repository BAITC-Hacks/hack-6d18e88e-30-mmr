import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../src/app/store.ts';
import { seedTasks, seedTeams } from '../src/data/syntheticData.ts';
import { calculateRating } from '../src/services/ratingService.ts';
import { calculateTeamMatch } from '../src/services/teamMatchService.ts';
import { clearStorageError, getStorageError, restoreState, safeLocalStorage, validateStoredState } from '../src/app/persistence.ts';

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  memory.clear(); clearStorageError(); useAppStore.getState().resetDemo();
});

test('confirmed filler, repeated words and invisible padding do not earn readiness points', () => {
  const fields = ['context', 'need', 'availableData', 'expectedResult', 'successCriteria', 'constraints', 'targetUsers', 'contact', 'consultationFormat'] as const;
  for (const text of ['placeholder '.repeat(12), 'важно '.repeat(30), 'а'.repeat(120), 'тест\u200b'.repeat(15), 'lorem ipsum '.repeat(10), 'x\u200b'.repeat(60)]) {
    const task = structuredClone(seedTasks[0]);
    for (const field of fields) task[field] = text;
    task.confirmedFields = [...fields];
    assert.equal(calculateRating(task).total, 0, `Filler received credit: ${text.slice(0, 25)}`);
  }
  const task = { ...seedTasks[0], context: 'Кассир вручную сверяет продажи и остатки за каждую смену.', confirmedFields: ['context'] };
  assert.equal(calculateRating(task).contextNeed, 10);
  for (const availableData of ['Нужно уточнить только версию API, выгрузка CSV доступна за 2025 год.', 'Нет данных о клиентах, но есть обезличенные продажи в CSV за год.']) {
    assert.equal(calculateRating({ ...task, availableData, confirmedFields: ['availableData'] }).data, 20);
  }
});

test('evasive phrases receive 0 points; concise actionable criteria and data get full credit', () => {
  const fields = ['context', 'need', 'availableData', 'expectedResult', 'successCriteria', 'constraints', 'targetUsers', 'contact', 'consultationFormat'] as const;
  const evasiveTask = structuredClone(seedTasks[0]);
  for (const field of fields) {
    evasiveTask[field] = 'Этот вопрос обсудим позже, сейчас конкретной информации у нас нет.';
  }
  evasiveTask.confirmedFields = [...fields];
  const rating = calculateRating(evasiveTask);
  assert.equal(rating.total, 0, 'Evasive task must receive 0 total points');
  assert.equal(rating.potentialTotal, 0, 'Evasive task must have 0 potential');

  const baseTask = structuredClone(seedTasks[0]);
  // successCriteria: "F1 ≥ 0.9" gets full 15 points
  const metricTask = { ...baseTask, successCriteria: 'F1 ≥ 0.9', confirmedFields: ['successCriteria'] };
  assert.equal(calculateRating(metricTask).successCriteria, 15);

  // availableData: distinguishes lack of data, planned collection, and concrete sources
  const noDataTask = { ...baseTask, availableData: 'Данных пока нет, у нас нет информации.', confirmedFields: ['availableData'] };
  assert.equal(calculateRating(noDataTask).data, 0);

  const plannedTask = { ...baseTask, availableData: 'Планируем собрать логи транзакций за следующий месяц.', confirmedFields: ['availableData'] };
  assert.equal(calculateRating(plannedTask).data, 10);

  const csvTask = { ...baseTask, availableData: 'Доступна выгрузка транзакций в формате CSV за 2025 год.', confirmedFields: ['availableData'] };
  assert.equal(calculateRating(csvTask).data, 20);

  // contact: arbitrary characters vs valid communication channel
  const randomContactTask = { ...baseTask, contact: '1234567890', confirmedFields: ['contact'] };
  assert.equal(calculateRating(randomContactTask).businessCommunication, 2);

  const emailContactTask = { ...baseTask, contact: 'lead@bank.kz', confirmedFields: ['contact'] };
  assert.equal(calculateRating(emailContactTask).businessCommunication, 5);

  const tgContactTask = { ...baseTask, contact: 'Telegram: @lead_pm', confirmedFields: ['contact'] };
  assert.equal(calculateRating(tgContactTask).businessCommunication, 5);
});

test('adding unrelated team capabilities cannot reduce matching relevance', () => {
  const task = { ...seedTasks[0], title: '', industry: '', tags: ['Python'], context: '', need: '', targetUsers: '', availableData: '', constraints: '', expectedResult: '' };
  const team = { ...seedTeams[0], technologies: ['Python'], skills: [], interests: [], industries: [] };
  const before = calculateTeamMatch(task, team);
  const after = calculateTeamMatch(task, { ...team, technologies: ['Python', 'Rust', 'Swift', 'Java'] });
  assert.equal(after.total, before.total);
  assert.equal(after.technologies, before.technologies);
});

test('explicitly forbidden technology does not become a positive team match', () => {
  const base = { ...seedTasks[0], title: '', industry: '', tags: ['Python'], context: '', need: '', targetUsers: '', availableData: '', expectedResult: '' };
  const team = { ...seedTeams[0], technologies: ['Python'], skills: [], interests: [], industries: [] };
  for (const constraints of ['Не использовать Python.', 'Python запрещён.', 'Do not use Python.', 'Python is not allowed.', 'Python қолдануға болмайды.']) {
    assert.equal(calculateTeamMatch({ ...base, constraints }, team).technologies, 0, constraints);
  }
  assert.equal(calculateTeamMatch({ ...base, constraints: 'Не использовать Excel. Python разрешён.' }, team).technologies, 100);
  assert.equal(calculateTeamMatch({ ...base, constraints: 'Python не запрещён.' }, team).technologies, 100);
});

test('successful saving clears a previous quota warning; absent storage reports data loss risk', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { ...storage, setItem() { throw new Error('quota'); } } });
  safeLocalStorage.setItem('audit', 'one');
  assert.ok(getStorageError());
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  safeLocalStorage.setItem('audit', 'two');
  assert.equal(getStorageError(), null);
  Reflect.deleteProperty(globalThis, 'localStorage');
  safeLocalStorage.setItem('audit', 'three');
  assert.ok(getStorageError(), 'Unavailable storage must not pretend that changes were saved');
});

test('hydration rejects malformed dates and empty proposals instead of rendering invalid records', () => {
  const fallback = useAppStore.getState();
  const saved = JSON.parse(JSON.stringify(fallback));
  const badTask = saved.tasks[0].id;
  saved.tasks[0].createdAt = 'invalid date';
  const badProposal = saved.proposals.at(-1).id;
  saved.proposals.at(-1).idea = '   ';
  const restored = restoreState(saved, fallback);
  assert.ok(!restored.tasks.some(task => task.id === badTask));
  assert.ok(!restored.proposals.some(proposal => proposal.id === badProposal));
  assert.equal(validateStoredState(saved), null);
});

test('corrupted empty confirmed tasks cannot reappear as published tasks after reload', () => {
  const fallback = useAppStore.getState();
  const saved = JSON.parse(JSON.stringify(fallback));
  saved.tasks[0].title = ' ';
  saved.tasks[0].confirmed = true;
  saved.tasks[0].published = true;
  const task = restoreState(saved, fallback).tasks.find(task => task.id === saved.tasks[0].id)!;
  assert.equal(task.published, false);
  assert.equal(task.confirmed, false);
});
