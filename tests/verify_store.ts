import assert from 'node:assert/strict';
import { useAppStore } from '../frontend/src/app/store';
import { seedTasks, seedTeams, seedProposals, createEmptyTask } from '../frontend/src/data/syntheticData';
import { calculateRating } from '../frontend/src/services/ratingService';
import { STORAGE_KEY, validateStoredState, milestoneSchema } from '../frontend/src/services/storageService';
import { ensureStarterMilestones } from '../frontend/src/app/persistence';
import type { Task } from '../frontend/src/types/task';
import type { Proposal } from '../frontend/src/types/proposal';

const memory = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const workingStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};
const state = () => useAppStore.getState();
const task = (id: string) => state().tasks.find(item => item.id === id)!;
const teamPoints = (id: string) => state().teams.find(item => item.id === id)!.progressPoints;
function installStorage(value: object = workingStorage) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value });
}
function reset() { installStorage(); memory.clear(); state().resetDemo(); }
function makeProposal(id: string, taskId = 'task-logistics', teamId = 'team-neuralforge'): Proposal {
  return { ...structuredClone(seedProposals[0]), id, taskId, teamId, status: 'pending' };
}
async function verify() {
  reset();
  const pristineSeeds = JSON.stringify({ seedTasks, seedTeams, seedProposals });
  state().tasks[0].tags.push('accidental mutation');
  state().tasks[0].confirmedFields.length = 0;
  state().teams[0].skills.length = 0;
  state().proposals[0].idea = 'mutated';
  assert.equal(JSON.stringify({ seedTasks, seedTeams, seedProposals }), pristineSeeds);
  state().resetDemo();
  assert.deepEqual(state().tasks, seedTasks);
  assert.deepEqual(state().teams, seedTeams);
  assert.equal(state().milestones.length, 0);
  console.log('PASS: deep seed isolation and repeatable reset');

  const draft: Task = { ...structuredClone(seedTasks.find(item => item.id === 'task-retail')!), id: 'new-draft' };
  state().addTask(draft);
  state().addTask(draft);
  assert.equal(state().tasks.filter(item => item.id === draft.id).length, 1);
  assert.equal(task(draft.id).rating, 100, 'Completeness is live before business approval');
  assert.deepEqual(task(draft.id).confirmedFields, []);
  assert.equal(state().publishTask(draft.id), false);
  assert.equal(state().confirmTask(draft.id), true);
  assert.equal(state().publishTask(draft.id), true);
  state().updateTask({ ...task(draft.id), availableData: '' });
  assert.equal(task(draft.id).confirmed, false);
  assert.equal(task(draft.id).published, false);
  assert.deepEqual(task(draft.id).confirmedFields, [], 'Content edits invalidate card approval as a whole');
  assert.equal(task(draft.id).rating, 80);
  assert.equal(task(draft.id).rating, calculateRating(task(draft.id)).total);
  state().confirmTask(draft.id);
  state().publishTask(draft.id);
  assert.equal(task(draft.id).published, true);
  const taskCount = state().tasks.length;
  assert.doesNotThrow(() => state().addTask({ id: 'broken' } as Task));
  assert.equal(state().tasks.length, taskCount);
  console.log('PASS: live draft rating and explicit confirm/publish/edit/reconfirm');

  reset();
  const count = state().proposals.length;
  assert.equal(state().addProposal(makeProposal('wrong-role')), false);
  state().setActiveRole('student');
  state().setActiveTeam('team-neuralforge');
  assert.equal(state().addProposal(makeProposal('orphan', 'missing')), false);
  assert.equal(state().addProposal(makeProposal('orphan-team', 'task-logistics', 'missing')), false);
  assert.equal(state().addProposal(makeProposal('private', 'draft-retail')), false);
  assert.ok(task('task-logistics').rating < 40);
  assert.equal(state().addProposal({ ...makeProposal('low-rating'), status: 'selected' }), true);
  assert.equal(state().addProposal(makeProposal('same-team-new-id')), false, 'A team submits once per task');
  assert.equal(state().proposals.length, count + 1);
  assert.equal(state().proposals.find(item => item.id === 'low-rating')?.status, 'pending');
  state().setActiveTeam('team-bytecrew');
  assert.equal(state().addProposal(makeProposal('second-team', 'task-logistics', 'team-bytecrew')), true);
  assert.equal(state().selectProposal('low-rating'), false, 'Students cannot select themselves');
  const unchangedTask = state().tasks[0];
  state().updateTask({ ...unchangedTask, title: 'Student edit' });
  state().addTask(createEmptyTask());
  assert.equal(state().tasks[0].title, unchangedTask.title);
  state().setActiveRole('business');
  state().selectProposal('low-rating');
  assert.equal(state().proposals.find(item => item.id === 'second-team')?.status, 'pending');
  state().selectProposal('second-team');
  state().selectProposal('second-team');
  assert.equal(state().milestones.filter(item => item.taskId === 'task-logistics').length, 8);
  assert.equal(new Set(state().milestones.map(item => item.id)).size, state().milestones.length);
  assert.deepEqual(ensureStarterMilestones(state().proposals, state().milestones), state().milestones);
  console.log('PASS: role checks, low-readiness access, duplicate prevention, multiple manual selections and four stages each');

  const milestone = state().milestones.find(item => item.teamId === 'team-neuralforge' && item.title === 'Prototype')!;
  const initial = teamPoints(milestone.teamId);
  for (const points of [-50, Infinity, 0.5]) assert.equal(milestoneSchema.safeParse({ ...milestone, points }).success, false);
  assert.equal(validateStoredState({ ...state(), milestones: state().milestones.map(item => item.id === milestone.id ? { ...item, points: 25 } : item) }), null, 'Invalid stage awards are not hydrated');
  assert.equal(state().rejectProposal('low-rating'), false, 'A project with milestones cannot be silently revoked');
  state().setActiveRole('student');
  assert.equal(state().confirmMilestone(milestone.id), false);
  state().setActiveRole('business');
  state().confirmMilestone(milestone.id);
  state().confirmMilestone(milestone.id);
  await useAppStore.persist.rehydrate();
  state().confirmMilestone(milestone.id);
  assert.equal(teamPoints(milestone.teamId), initial + 10);
  assert.ok(state().milestones.find(item => item.id === milestone.id)!.confirmedAt);
  console.log('PASS: validated manual stage awards remain idempotent across reload');

  const validSave = JSON.parse(memory.get(STORAGE_KEY)!);
  validSave.state.tasks[0].rating = 1;
  validSave.state.tasks[0].readinessLevel = 'priority';
  validSave.state.resetDemo = 'persisted data is not executable';
  memory.set(STORAGE_KEY, JSON.stringify(validSave));
  await useAppStore.persist.rehydrate();
  assert.equal(state().tasks[0].rating, calculateRating(state().tasks[0]).total);
  assert.equal(typeof state().resetDemo, 'function');
  state().setActiveTask('missing');
  state().setActiveTeam('missing');
  assert.notEqual(state().activeTaskId, 'missing');
  assert.notEqual(state().activeTeamId, 'missing');
  for (const corrupted of [
    { ...validSave.state, tasks: [...validSave.state.tasks, { id: 'broken' }] },
    { ...validSave.state, teams: [...validSave.state.teams, { ...validSave.state.teams[0], progressPoints: -10 }] },
    { ...validSave.state, proposals: [...validSave.state.proposals, makeProposal('orphan', 'missing')] },
    { ...validSave.state, activeTeamId: 'missing' },
  ]) assert.equal(validateStoredState(corrupted), null, 'Structurally corrupt snapshots are rejected as a whole');
  console.log('PASS: schema/reference validation, derived-score repair and store-action protection');

  reset();
  memory.set(STORAGE_KEY, '{broken-json');
  await useAppStore.persist.rehydrate();
  assert.equal(useAppStore.persist.hasHydrated(), true);
  assert.deepEqual(state().tasks, seedTasks);
  assert.ok(state().storageError);
  memory.set(STORAGE_KEY, JSON.stringify({ state: { tasks: null }, version: 1 }));
  await useAppStore.persist.rehydrate();
  assert.equal(state().tasks.length, seedTasks.length);
  installStorage({ getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Quota'); }, removeItem() { throw new Error('Blocked'); } });
  assert.doesNotThrow(() => state().setActiveRole('student'));
  assert.equal(state().activeRole, 'student');
  assert.ok(state().storageError);
  await useAppStore.persist.rehydrate();
  assert.doesNotThrow(() => useAppStore.persist.clearStorage());
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  assert.doesNotThrow(() => state().resetDemo());
  await useAppStore.persist.rehydrate();
  assert.equal(state().activeRole, 'business');
  console.log('PASS: corrupt JSON, blocked storage and quota/access exceptions');
}
verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
