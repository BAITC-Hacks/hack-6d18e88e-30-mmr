import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../src/app/store.ts';
import { RATING_CATEGORIES } from '../src/app/constants.ts';
import { createEmptyTask, demoAnswers, seedProposals, seedTasks, seedTeams } from '../src/data/syntheticData.ts';
import { calculateRating, getReadinessLevel } from '../src/services/ratingService.ts';
import { calculateTeamMatch } from '../src/services/teamMatchService.ts';
import { clearStorageError, getStorageError, safeLocalStorage, STORAGE_KEY, STORAGE_VERSION, validateStoredState } from '../src/services/storageService.ts';
import type { Proposal } from '../src/types/proposal.ts';

const memory = new Map<string, string>();
const storage: Storage = {
  get length() { return memory.size; },
  clear: () => memory.clear(),
  getItem: key => memory.get(key) ?? null,
  key: index => [...memory.keys()][index] ?? null,
  removeItem: key => { memory.delete(key); },
  setItem: (key, value) => { memory.set(key, value); },
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
const current = () => useAppStore.getState();
const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: crypto.randomUUID(), taskId: 'task-logistics', teamId: 'team-neuralforge',
  idea: 'Сравним текущие маршруты с оптимизированными и покажем выигрыш диспетчеру.',
  implementationPlan: 'Уточним данные, реализуем алгоритм, проверим на доставках за неделю.',
  estimatedTime: '3 недели', prototypeUrl: '', status: 'pending', createdAt: new Date().toISOString(), ...overrides,
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  memory.clear();
  clearStorageError();
  current().resetDemo();
});

test('seed dataset covers five industries and every readiness level, including a published draft', () => {
  assert.equal(seedTasks.filter(task => !task.published).length, 5);
  assert.equal(seedTasks.filter(task => task.published).length, 5);
  assert.equal(seedTeams.length, 5);
  assert.ok(seedProposals.length >= 5);
  assert.equal(new Set(seedTasks.map(task => task.industry)).size, 5);
  assert.deepEqual(new Set(seedTasks.filter(task => task.published).map(task => task.readinessLevel)), new Set(['draft', 'working', 'ready', 'priority']));
  assert.ok(seedTasks.some(task => task.published && task.rating < 40));
});

test('rating boundaries and weights follow the 100-point rubric', () => {
  assert.equal(RATING_CATEGORIES.reduce((sum, category) => sum + category.max, 0), 100);
  assert.deepEqual([0, 39, 40, 69, 70, 89, 90, 100].map(getReadinessLevel), ['draft', 'draft', 'working', 'working', 'ready', 'ready', 'priority', 'priority']);
  assert.equal(calculateRating(createEmptyTask()).total, 0);
  for (const task of seedTasks) {
    const score = calculateRating(task);
    assert.equal(score.total, RATING_CATEGORIES.reduce((sum, category) => sum + score[category.key], 0));
    assert.ok(RATING_CATEGORIES.every(category => score[category.key] >= 0 && score[category.key] <= category.max));
    assert.equal(score.potentialTotal, 100);
  }
});

test('specific answers increase rating, remove resolved advice and expose accurate possible gains', () => {
  const weak = { ...createEmptyTask(), context: 'Нужен прогноз', need: 'Улучшить продажи' };
  const before = calculateRating(weak);
  const strong = { ...weak, ...demoAnswers };
  const after = calculateRating(strong);
  assert.ok(after.total > before.total);
  assert.equal(after.total, 100);
  assert.equal(after.recommendations.length, 0);
  const criterionOnly = { ...weak, successCriteria: demoAnswers.successCriteria };
  const criterionGain = calculateRating(criterionOnly).total - before.total;
  assert.equal(criterionGain, before.recommendations.find(item => item.field === 'successCriteria')?.possibleGain);
  assert.equal(calculateRating({ ...createEmptyTask(), context: 'TBD', need: 'не знаю', successCriteria: 'нет' }).total, 0);
});

test('team matching changes with capabilities and explains required matches and gaps', () => {
  const retail = seedTasks.find(task => task.id === 'task-retail')!;
  const data = calculateTeamMatch(retail, seedTeams.find(team => team.id === 'team-datalab')!);
  const web = calculateTeamMatch(retail, seedTeams.find(team => team.id === 'team-bytecrew')!);
  assert.ok(data.total > web.total);
  assert.ok(data.matching.includes('Python'));
  assert.ok(web.missing.includes('Python'));
  const unrelated = calculateTeamMatch(retail, { ...seedTeams[0], technologies: [], skills: [], interests: [], industries: [] });
  assert.equal(unrelated.total, 0);
  assert.ok(seedTasks.every(task => seedTeams.every(team => {
    const match = calculateTeamMatch(task, team);
    return [match.total, match.technologies, match.skills, match.interests, match.industry].every(value => value >= 0 && value <= 100);
  })));
});

test('publication requires explicit confirmation and low readiness is allowed', () => {
  const draft = current().tasks.find(task => task.id === 'draft-retail')!;
  assert.equal(current().publishTask(draft.id), false);
  assert.equal(current().confirmTask(draft.id), true);
  assert.equal(current().publishTask(draft.id), true);
  const published = current().tasks.find(task => task.id === draft.id)!;
  assert.equal(published.published, true);
  assert.ok(published.rating < 40);
});

test('content edits invalidate confirmation and publication and recalculate readiness', () => {
  const previous = current().tasks.find(task => task.id === 'task-retail')!;
  current().updateTask({ ...previous, availableData: '', rating: 100, readinessLevel: 'priority' });
  const edited = current().tasks.find(task => task.id === previous.id)!;
  assert.equal(edited.confirmed, false);
  assert.equal(edited.published, false);
  assert.deepEqual(edited.confirmedFields, []);
  assert.equal(edited.rating, calculateRating(edited).total);
  assert.ok(edited.rating < previous.rating);
  assert.equal(current().publishTask(edited.id), false);
  assert.equal(current().confirmTask(edited.id), true);
  assert.equal(current().publishTask(edited.id), true);
});

test('task input cannot bypass the confirmation action', () => {
  const fresh = { ...createEmptyTask(), ...demoAnswers, confirmed: true, published: true };
  current().addTask(fresh);
  assert.equal(current().tasks.find(task => task.id === fresh.id)?.confirmed, false);
  assert.equal(current().tasks.find(task => task.id === fresh.id)?.published, false);
  current().updateTask(fresh);
  assert.equal(current().tasks.find(task => task.id === fresh.id)?.confirmed, false);
});

test('student role cannot alter business data or confirm milestones', () => {
  current().selectProposal('proposal-retail-neural');
  const milestoneId = current().milestones[0].id;
  const count = current().tasks.length;
  const original = current().tasks[0];
  current().setActiveRole('student');
  assert.equal(current().page, 'catalog');
  current().addTask(createEmptyTask());
  current().updateTask({ ...original, title: 'Изменено студентом' });
  assert.equal(current().confirmTask(original.id), false);
  assert.equal(current().publishTask(original.id), false);
  assert.equal(current().selectProposal('proposal-retail-data'), false);
  assert.equal(current().rejectProposal('proposal-retail-data'), false);
  assert.equal(current().confirmMilestone(milestoneId), false);
  assert.equal(current().tasks.length, count);
  assert.equal(current().tasks[0].title, original.title);
  assert.equal(current().milestones[0].status, 'pending');
  current().navigate('builder');
  assert.equal(current().page, 'catalog');
});

test('student can respond to a low-rated published task but not submit a duplicate', () => {
  current().setActiveRole('student');
  const submission = proposal();
  assert.ok(current().tasks.find(task => task.id === submission.taskId)!.rating < 40);
  assert.equal(current().addProposal(submission), true);
  assert.equal(current().addProposal({ ...submission, id: crypto.randomUUID() }), false);
  assert.equal(current().proposals.filter(item => item.taskId === submission.taskId && item.teamId === submission.teamId).length, 1);
});

test('proposal validation checks role, active team, required content, unpublished tasks and unsafe URLs', () => {
  assert.equal(current().addProposal(proposal()), false);
  current().setActiveRole('student');
  assert.equal(current().addProposal(proposal({ teamId: 'team-bytecrew' })), false);
  assert.equal(current().addProposal(proposal({ taskId: 'draft-retail' })), false);
  assert.equal(current().addProposal(proposal({ idea: '   ' })), false);
  assert.equal(current().addProposal(proposal({ prototypeUrl: 'javascript:alert(1)' })), false);
  assert.equal(current().addProposal(proposal({ prototypeUrl: 'https://example.com/demo', status: 'selected' })), true);
  assert.equal(current().proposals[0].status, 'pending');
});

test('business can select multiple teams without rejecting other proposals or duplicating milestones', () => {
  assert.equal(current().selectProposal('proposal-retail-neural'), true);
  assert.equal(current().proposals.find(item => item.id === 'proposal-retail-data')?.status, 'pending');
  assert.equal(current().milestones.length, 4);
  assert.equal(current().selectProposal('proposal-retail-neural'), true);
  assert.equal(current().milestones.length, 4);
  assert.equal(current().selectProposal('proposal-retail-data'), true);
  assert.equal(current().milestones.length, 8);
  assert.equal(current().proposals.filter(item => item.status === 'selected').length, 2);
  assert.equal(current().rejectProposal('proposal-retail-neural'), false);
});

test('milestone confirmation awards points exactly once and does not change task readiness', () => {
  current().selectProposal('proposal-retail-neural');
  const prototype = current().milestones.find(item => item.title === 'Prototype')!;
  const rating = current().tasks.find(task => task.id === prototype.taskId)!.rating;
  assert.equal(current().confirmMilestone(prototype.id), true);
  assert.equal(current().confirmMilestone(prototype.id), true);
  assert.equal(current().teams.find(team => team.id === prototype.teamId)!.progressPoints, 10);
  assert.equal(current().tasks.find(task => task.id === prototype.taskId)!.rating, rating);
  assert.ok(current().milestones.find(item => item.id === prototype.id)!.confirmedAt);
});

test('persistence restores selected teams, proposals, milestones, role and active team', async () => {
  current().selectProposal('proposal-retail-neural');
  current().confirmMilestone(current().milestones[0].id);
  current().setActiveRole('student');
  current().setActiveTeam('team-bytecrew');
  current().navigate('my-proposals');
  const saved = memory.get(STORAGE_KEY)!;
  assert.equal(JSON.parse(saved).version, STORAGE_VERSION);
  current().resetDemo();
  memory.set(STORAGE_KEY, saved);
  await useAppStore.persist.rehydrate();
  assert.equal(current().activeRole, 'student');
  assert.equal(current().activeTeamId, 'team-bytecrew');
  assert.equal(current().page, 'my-proposals');
  assert.equal(current().milestones.length, 4);
  assert.equal(current().milestones.filter(item => item.status === 'completed').length, 1);
  assert.equal(current().teams.find(team => team.id === 'team-neuralforge')!.progressPoints, 5);
  assert.equal(current().proposals.find(item => item.id === 'proposal-retail-neural')?.status, 'selected');
});

test('malformed JSON and invalid references recover without crashing the app', async () => {
  memory.set(STORAGE_KEY, '{ broken');
  await useAppStore.persist.rehydrate();
  assert.equal(current().tasks.length, 10);
  assert.ok(current().storageError);
  const saved = { ...current(), proposals: [{ ...current().proposals[0], teamId: 'does-not-exist' }] };
  assert.equal(validateStoredState(saved), null);
  assert.equal(validateStoredState({ ...current(), tasks: [{ ...current().tasks[0], tags: null }] }), null);
  assert.equal(validateStoredState({ ...current(), teams: [current().teams[0], current().teams[0]] }), null);
});

test('storage quota errors leave the application usable and expose a visible error', () => {
  Object.defineProperty(globalThis, 'localStorage', { value: { ...storage, setItem() { throw new Error('Quota exceeded'); } }, configurable: true });
  assert.doesNotThrow(() => current().setActiveTeam('team-datalab'));
  assert.equal(current().activeTeamId, 'team-datalab');
  assert.ok(current().storageError);
  assert.doesNotThrow(() => safeLocalStorage.setItem(STORAGE_KEY, 'value'));
  assert.ok(getStorageError());
});

test('hydration rejects inconsistent publication and projects, recalculates derived data and repairs role routes', () => {
  assert.equal(validateStoredState({ ...current(), tasks: [{ ...current().tasks[0], published: true, confirmed: false }] }), null);
  const selectedWithoutProject = { ...current(), proposals: current().proposals.map((item, index) => index === 0 ? { ...item, status: 'selected' } : item) };
  assert.equal(validateStoredState(selectedWithoutProject), null);
  current().selectProposal('proposal-retail-neural');
  current().confirmMilestone(current().milestones[0].id);
  const repaired = validateStoredState({ ...current(), activeRole: 'student', page: 'builder', activeTaskId: 'draft-retail',
    teams: current().teams.map(team => ({ ...team, progressPoints: 999 })), tasks: current().tasks.map(task => ({ ...task, rating: 1, readinessLevel: 'draft' })),
  });
  assert.ok(repaired);
  assert.equal(repaired.page, 'catalog');
  assert.equal(repaired.activeTaskId, null);
  assert.equal(repaired.teams.find(team => team.id === 'team-neuralforge')?.progressPoints, 5);
  assert.equal(repaired.tasks.find(task => task.id === 'task-retail')?.rating, 100);
});

test('reset creates fresh seed objects and restores the full original demo', () => {
  current().selectProposal('proposal-retail-neural');
  current().confirmMilestone(current().milestones[0].id);
  current().updateTask({ ...current().tasks[0], title: 'Изменённый черновик' });
  current().resetDemo();
  assert.deepEqual(current().tasks, seedTasks);
  assert.deepEqual(current().teams, seedTeams);
  assert.deepEqual(current().proposals, seedProposals);
  assert.equal(current().milestones.length, 0);
  assert.notEqual(current().tasks[0], seedTasks[0]);
  assert.equal(current().activeRole, 'business');
  assert.equal(current().demoStep, 0);
});
