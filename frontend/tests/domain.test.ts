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
  assert.equal(seedTasks.filter(task => task.published).length, 10);
  assert.equal(seedTeams.length, 10);
  assert.ok(seedProposals.length >= 5);
  assert.ok(new Set(seedTasks.map(task => task.industry)).size >= 5);
  assert.ok(seedTasks.some(task => task.id === 'task-1'));
  assert.ok(seedTasks.some(task => task.id === 'task-retail'));
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
    assert.ok(score.potentialTotal >= score.total && score.potentialTotal <= 100);
    assert.equal(score.potentialTotal, calculateRating({ ...task, confirmedFields: Object.keys(demoAnswers) }).total);
    assert.equal(score.total + score.recommendations.reduce((sum, item) => sum + item.possibleGain, 0), 100);
  }
});

test('specific answers increase rating, remove resolved advice and expose accurate possible gains', () => {
  const weak = { ...createEmptyTask(), context: 'Нужен прогноз', need: 'Улучшить продажи' };
  const before = calculateRating(weak);
  const unconfirmed = { ...weak, ...demoAnswers };
  assert.equal(calculateRating(unconfirmed).total, 0);
  assert.equal(calculateRating(unconfirmed).potentialTotal, 100);
  const strong = { ...unconfirmed, confirmedFields: Object.keys(demoAnswers) };
  const after = calculateRating(strong);
  assert.ok(after.total > before.total);
  assert.equal(after.total, 100);
  assert.equal(after.recommendations.length, 0);
  const criterionOnly = { ...weak, successCriteria: demoAnswers.successCriteria, confirmedFields: ['successCriteria'] };
  const criterionGain = calculateRating(criterionOnly).total - before.total;
  assert.equal(criterionGain, before.recommendations.find(item => item.field === 'successCriteria')?.possibleGain);
  assert.equal(calculateRating({ ...createEmptyTask(), context: 'TBD', need: 'не знаю', successCriteria: 'нет', confirmedFields: ['context', 'need', 'successCriteria'] }).total, 0);
});

test('team matching changes with capabilities and explains required matches and gaps', () => {
  const retail = seedTasks.find(task => task.id === 'task-retail')!;
  const data = calculateTeamMatch(retail, seedTeams.find(team => team.id === 'team-datalab')!);
  const web = calculateTeamMatch(retail, seedTeams.find(team => team.id === 'team-bytecrew')!);
  assert.ok(data.total > web.total);
  assert.ok(data.matching.includes('Python'));
  assert.deepEqual(data.matching, data.matchedTags);
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
  assert.ok(!edited.confirmedFields.includes('availableData'));
  assert.ok(edited.confirmedFields.includes('context'));
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

test('student can respond to a low-rated task with distinct ideas; proposal IDs are unique', () => {
  current().setActiveRole('student');
  const submission = proposal();
  assert.ok(current().tasks.find(task => task.id === submission.taskId)!.rating < 40);
  assert.equal(current().addProposal(submission), true);
  assert.equal(current().addProposal(submission), false);
  assert.equal(current().addProposal({ ...submission, id: crypto.randomUUID(), idea: 'Другой подход к планированию маршрутов.' }), true);
  assert.equal(current().proposals.filter(item => item.taskId === submission.taskId && item.teamId === submission.teamId).length, 2);
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
  const initialMilestones = current().milestones.length;
  assert.equal(current().selectProposal('proposal-retail-neural'), true);
  assert.equal(current().proposals.find(item => item.id === 'proposal-retail-data')?.status, 'pending');
  assert.equal(current().milestones.length, initialMilestones + 4);
  assert.equal(current().selectProposal('proposal-retail-neural'), true);
  assert.equal(current().milestones.length, initialMilestones + 4);
  assert.equal(current().selectProposal('proposal-retail-data'), true);
  assert.equal(current().milestones.length, initialMilestones + 8);
  assert.equal(current().proposals.filter(item => item.taskId === 'task-retail' && item.status === 'selected').length, 2);
  assert.equal(current().rejectProposal('proposal-retail-neural'), true);
  const revoked = current().milestones.find(item => item.taskId === 'task-retail' && item.teamId === 'team-neuralforge')!;
  assert.equal(current().confirmMilestone(revoked.id), false);
  assert.equal(current().selectProposal('proposal-retail-neural'), true);
  assert.equal(current().milestones.length, initialMilestones + 8);
});

test('milestone confirmation awards points exactly once and does not change task readiness', () => {
  current().selectProposal('proposal-retail-neural');
  const prototype = current().milestones.find(item => item.title === 'Prototype' && item.taskId === 'task-retail')!;
  const rating = current().tasks.find(task => task.id === prototype.taskId)!.rating;
  assert.equal(current().confirmMilestone(prototype.id), true);
  assert.equal(current().confirmMilestone(prototype.id), true);
  assert.equal(current().teams.find(team => team.id === prototype.teamId)!.progressPoints, 10);
  assert.equal(current().tasks.find(task => task.id === prototype.taskId)!.rating, rating);
  assert.ok(current().milestones.find(item => item.id === prototype.id)!.confirmedAt);
});

test('persistence restores selected teams, proposals, milestones, role and active team', async () => {
  const initialMilestones = current().milestones.length;
  current().selectProposal('proposal-retail-neural');
  current().confirmMilestone(current().milestones.find(item => item.taskId === 'task-retail')!.id);
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
  assert.equal(current().milestones.length, initialMilestones + 4);
  assert.equal(current().milestones.filter(item => item.status === 'completed').length, 1);
  assert.equal(current().teams.find(team => team.id === 'team-neuralforge')!.progressPoints, 5);
  assert.equal(current().proposals.find(item => item.id === 'proposal-retail-neural')?.status, 'selected');
});

test('malformed JSON and invalid references recover without crashing the app', async () => {
  memory.set(STORAGE_KEY, '{ broken');
  await useAppStore.persist.rehydrate();
  assert.equal(current().tasks.length, seedTasks.length);
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
  const selectedWithoutProject = { ...current(), proposals: current().proposals.map(item => item.id === 'proposal-retail-neural' ? { ...item, status: 'selected' } : item) };
  const repairedProject = validateStoredState(selectedWithoutProject);
  assert.equal(repairedProject?.milestones.filter(item => item.taskId === 'task-retail').length, 4);
  current().selectProposal('proposal-retail-neural');
  current().confirmMilestone(current().milestones.find(item => item.taskId === 'task-retail')!.id);
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
  assert.equal(current().milestones.length, 8);
  assert.notEqual(current().tasks[0], seedTasks[0]);
  assert.equal(current().activeRole, 'business');
  assert.equal(current().demoStep, 0);
});

test('builder draft and field provenance survive save/reload without sharing caller objects', async () => {
  const task = { ...createEmptyTask('Нужен прогноз спроса по магазинам.'), ...demoAnswers,
    fieldSources: { availableData: 'clarification' as const },
  };
  current().addTask(task);
  task.fieldSources.availableData = 'manual' as 'clarification';
  const savedTask = current().tasks.find(item => item.id === task.id)!;
  assert.equal(savedTask.fieldSources?.availableData, 'clarification');
  assert.equal(savedTask.rawDraft, 'Нужен прогноз спроса по магазинам.');
  assert.equal(savedTask.rating, 0);
  await useAppStore.persist.rehydrate();
  const restored = current().tasks.find(item => item.id === task.id)!;
  assert.equal(restored.fieldSources?.availableData, 'clarification');
  assert.equal(restored.rawDraft, savedTask.rawDraft);
  current().confirmTask(task.id);
  current().publishTask(task.id);
  current().updateTask({ ...current().tasks.find(item => item.id === task.id)!, rawDraft: 'Уточнённый черновик для магазинов.' });
  assert.equal(current().tasks.find(item => item.id === task.id)?.confirmed, false);
  assert.equal(current().tasks.find(item => item.id === task.id)?.published, false);
});

test('legacy platform saves keep their original milestone and points while receiving new demo records', async () => {
  const team = seedTeams.find(item => item.id === 'team-1')!;
  const task = seedTasks.find(item => item.id === 'task-1')!;
  const selected = seedProposals.find(item => item.id === 'prop-1')!;
  const milestone = { id: 'legacy-work', taskId: task.id, teamId: team.id, title: 'Original MVP stage',
    description: 'Accepted prototype', points: 50, status: 'completed', confirmedAt: new Date().toISOString() };
  memory.set(STORAGE_KEY, JSON.stringify({ version: 0, state: {
    tasks: [{ ...task, title: 'User-edited legacy task' }], teams: [{ ...team, progressPoints: team.progressPoints + 50 }],
    proposals: [selected], milestones: [milestone], activeRole: 'business', activeTeamId: team.id, activeTaskId: task.id,
  } }));
  await useAppStore.persist.rehydrate();
  assert.equal(current().tasks.length, seedTasks.length);
  assert.equal(current().teams.length, seedTeams.length);
  assert.equal(current().tasks.find(item => item.id === task.id)?.title, 'User-edited legacy task');
  assert.equal(current().milestones.filter(item => item.taskId === task.id && item.teamId === team.id).length, 1);
  assert.equal(current().teams.find(item => item.id === team.id)?.progressPoints, team.progressPoints + 50);
  current().confirmMilestone(milestone.id);
  assert.equal(current().teams.find(item => item.id === team.id)?.progressPoints, team.progressPoints + 50);
  assert.equal(JSON.parse(memory.get(STORAGE_KEY)!).version, STORAGE_VERSION);
});

test('the UI branch storage key migrates once into the shared platform save', async () => {
  current().setActiveRole('student');
  current().setActiveTeam('team-datalab');
  current().navigate('my-proposals');
  const saved = JSON.parse(memory.get(STORAGE_KEY)!);
  saved.version = 1;
  memory.clear();
  memory.set('ai-sana-demo', JSON.stringify(saved));
  await useAppStore.persist.rehydrate();
  assert.equal(current().activeTeamId, 'team-datalab');
  assert.equal(current().page, 'my-proposals');
  assert.equal(JSON.parse(memory.get(STORAGE_KEY)!).version, STORAGE_VERSION);
  assert.equal(memory.get('ai-sana-demo'), JSON.stringify(saved), 'The original save remains available for recovery.');
});
