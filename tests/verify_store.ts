import assert from 'node:assert/strict';
import { useAppStore } from '../frontend/src/app/store';
import { seedTasks, seedTeams, seedProposals } from '../frontend/src/data/syntheticData';
import { calculateRating, getReadinessLevel } from '../frontend/src/services/ratingService';
import type { Task } from '../frontend/src/types/task';
import type { Proposal } from '../frontend/src/types/proposal';
import type { Milestone } from '../frontend/src/types/milestone';

const storageKey = 'ai-sana-taskrank-v1';
const memory = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const workingStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};
const state = () => useAppStore.getState();
const task = (id: string) => state().tasks.find((item) => item.id === id)!;
const proposal = (id: string) => state().proposals.find((item) => item.id === id)!;
const teamPoints = (id: string) => state().teams.find((item) => item.id === id)!.progressPoints;
function installStorage(value: object = workingStorage) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value });
}
function reset() {
  installStorage();
  memory.clear();
  state().resetToSeedData();
}
function makeProposal(id: string, taskId = 'task-5', teamId = 'team-5'): Proposal {
  return { ...structuredClone(seedProposals[4]), id, taskId, teamId, status: 'pending' };
}
function makeMilestone(id: string, teamId = 'team-1'): Milestone {
  return { id, taskId: 'task-1', teamId, title: 'Demo result', description: 'Accepted prototype', points: 25, status: 'pending' };
}

async function verify() {
  reset();
  const pristineSeeds = JSON.stringify({ seedTasks, seedTeams, seedProposals });
  state().tasks[0].tags.push('accidental caller mutation');
  state().tasks[0].confirmedFields.length = 0;
  state().teams[0].skills.length = 0;
  state().proposals[0].idea = 'mutated';
  assert.equal(JSON.stringify({ seedTasks, seedTeams, seedProposals }), pristineSeeds, 'live state must never mutate imported seeds');
  state().resetToSeedData();
  assert.deepEqual(state().tasks[0].tags, seedTasks[0].tags);
  assert.deepEqual(state().teams[0].skills, seedTeams[0].skills);
  assert.equal(state().proposals[0].idea, seedProposals[0].idea);
  assert.ok(state().milestones.some((item) => item.taskId === 'task-1' && item.teamId === 'team-1'));
  console.log('PASS: nested seed isolation and repeatable demo reset');

  reset();
  const draft: Task = { ...structuredClone(seedTasks[0]), id: 'new-draft' };
  state().addTask(draft);
  state().addTask(draft);
  assert.equal(state().tasks.filter((item) => item.id === draft.id).length, 1);
  assert.equal(task(draft.id).rating, 0, 'adding generated content cannot confirm it');
  assert.deepEqual(task(draft.id).confirmedFields, []);
  state().publishTask(draft.id);
  assert.equal(task(draft.id).published, false, 'publishing requires prior human confirmation');
  state().confirmTask(draft.id);
  assert.equal(task(draft.id).rating, calculateRating(task(draft.id)).total);
  assert.ok(task(draft.id).rating > 0);
  state().publishTask(draft.id);
  assert.equal(task(draft.id).published, true);
  const oldRating = task(draft.id).rating;
  state().updateTask({ ...task(draft.id), need: 'Updated business need requires a newly confirmed description.' });
  assert.equal(task(draft.id).confirmed, false);
  assert.equal(task(draft.id).published, false);
  assert.ok(!task(draft.id).confirmedFields.includes('need'));
  assert.ok(task(draft.id).confirmedFields.includes('context'));
  assert.ok(task(draft.id).rating < oldRating, 'edited values cannot retain the previous approval');
  state().confirmTask(draft.id);
  state().publishTask(draft.id);
  assert.equal(task(draft.id).published, true);
  assert.ok(task(draft.id).confirmedFields.includes('need'));
  assert.equal(task(draft.id).rating, calculateRating(task(draft.id)).total);
  console.log('PASS: draft → confirm → publish → edit → reconfirm with live rating');

  reset();
  const proposalCount = state().proposals.length;
  state().addProposal(makeProposal('orphan-task', 'missing-task'));
  state().addProposal(makeProposal('orphan-team', 'task-5', 'missing-team'));
  state().addTask({ ...structuredClone(seedTasks[0]), id: 'private-draft' });
  state().setActiveRole('student');
  state().setActiveTeam('team-5');
  state().addProposal(makeProposal('private-proposal', 'private-draft'));
  assert.equal(state().proposals.length, proposalCount);
  assert.ok(task('task-5').rating < 40);
  state().addProposal({ ...makeProposal('low-rating'), status: 'selected' });
  state().addProposal(makeProposal('low-rating'));
  assert.equal(state().proposals.length, proposalCount + 1, 'low rating is no barrier; duplicate IDs are rejected');
  assert.equal(proposal('low-rating').status, 'pending', 'a submitted proposal never chooses itself');
  state().setActiveTeam('team-1');
  state().addProposal(makeProposal('second-team', 'task-5', 'team-1'));
  state().setActiveTeam('team-5');
  state().addProposal(makeProposal('another-idea', 'task-5', 'team-5'));
  state().setActiveRole('business');
  state().setProposalDecision('low-rating', 'selected');
  state().setProposalDecision('second-team', 'selected');
  state().setProposalDecision('another-idea', 'selected');
  state().setProposalDecision('second-team', 'selected');
  assert.equal(state().proposals.filter((item) => item.taskId === 'task-5' && item.status === 'selected').length, 3);
  assert.equal(state().milestones.filter((item) => item.taskId === 'task-5').length, 8, 'multiple teams allowed, one four-stage project per team/task');
  assert.equal(new Set(state().milestones.map((item) => item.id)).size, state().milestones.length);
  console.log('PASS: open low-rating proposals, multiple selected teams, stable milestone IDs');

  reset();
  const initialMilestones = state().milestones.length;
  const initialPoints = teamPoints('team-1');
  const otherPoints = teamPoints('team-2');
  state().addMilestone(makeMilestone('unselected', 'team-2'));
  state().addMilestone({ ...makeMilestone('negative'), points: -50 });
  state().addMilestone({ ...makeMilestone('infinite'), points: Infinity });
  state().addMilestone({ ...makeMilestone('fractional'), points: 0.5 });
  assert.equal(state().milestones.length, initialMilestones);
  state().addMilestone({ ...makeMilestone('work'), status: 'completed', confirmedAt: 'injected' });
  state().addMilestone(makeMilestone('work'));
  assert.equal(state().milestones.length, initialMilestones + 1);
  assert.equal(state().milestones.find((item) => item.id === 'work')!.status, 'pending');
  assert.equal(teamPoints('team-1'), initialPoints, 'creation is not confirmation');
  state().setProposalDecision('prop-1', 'rejected');
  state().confirmMilestone('work');
  assert.equal(teamPoints('team-1'), initialPoints, 'revoked teams cannot earn new points');
  state().setProposalDecision('prop-1', 'selected');
  state().confirmMilestone('work');
  state().confirmMilestone('work');
  await useAppStore.persist.rehydrate();
  state().confirmMilestone('work');
  assert.equal(teamPoints('team-1'), initialPoints + 25, 'retry/reload must not award twice');
  assert.equal(teamPoints('team-2'), otherPoints);
  assert.ok(state().milestones.find((item) => item.id === 'work')!.confirmedAt);
  console.log('PASS: selected-only, validated, manual and idempotent progress awards across reload');

  reset();
  const saved = JSON.parse(memory.get(storageKey)!);
  saved.state.tasks[0].rating = 999;
  saved.state.tasks[0].readinessLevel = 'draft';
  saved.state.tasks.push(saved.state.tasks[0], { id: 'broken' });
  saved.state.teams.push({ id: 'broken-team', progressPoints: -10 });
  saved.state.proposals.push(saved.state.proposals[0], makeProposal('orphan', 'missing-task'));
  saved.state.milestones.push(makeMilestone('orphan-milestone', 'missing-team'));
  saved.state.activeTeamId = 'missing-team';
  saved.state.activeTaskId = 'missing-task';
  saved.state.activeRole = 'unexpected-role';
  saved.state.resetToSeedData = 'persisted data is not a function';
  memory.set(storageKey, JSON.stringify(saved));
  await useAppStore.persist.rehydrate();
  assert.equal(state().tasks.length, seedTasks.length);
  assert.equal(state().teams.length, seedTeams.length);
  assert.equal(state().proposals.length, seedProposals.length);
  assert.ok(!state().milestones.some((item) => item.id === 'orphan-milestone'));
  assert.equal(task('task-1').rating, calculateRating(task('task-1')).total);
  assert.equal(task('task-1').readinessLevel, getReadinessLevel(task('task-1').rating));
  assert.ok(state().teams.some((team) => team.id === state().activeTeamId));
  assert.ok(state().tasks.some((item) => item.id === state().activeTaskId));
  assert.equal(state().activeRole, 'business');
  assert.equal(typeof state().resetToSeedData, 'function');
  state().setActiveTask('missing-task');
  state().setActiveTeam('missing-team');
  assert.notEqual(state().activeTaskId, 'missing-task');
  assert.notEqual(state().activeTeamId, 'missing-team');
  console.log('PASS: hydration validates records, references and selections; recalculates stale scores');

  reset();
  memory.set(storageKey, '{broken-json');
  await useAppStore.persist.rehydrate();
  assert.equal(useAppStore.persist.hasHydrated(), true);
  assert.equal(state().tasks.length, seedTasks.length);
  memory.set(storageKey, JSON.stringify({ state: { tasks: null, teams: 'broken', proposals: 5, milestones: {} } }));
  await useAppStore.persist.rehydrate();
  assert.equal(state().tasks.length, seedTasks.length);
  installStorage({
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Quota exceeded'); },
    removeItem() { throw new Error('Storage blocked'); },
  });
  assert.doesNotThrow(() => state().setActiveRole('student'));
  assert.equal(state().activeRole, 'student');
  await useAppStore.persist.rehydrate();
  assert.doesNotThrow(() => useAppStore.persist.clearStorage());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError on accessing localStorage'); },
  });
  assert.doesNotThrow(() => state().resetToSeedData());
  await useAppStore.persist.rehydrate();
  assert.equal(state().activeRole, 'business');
  assert.equal(useAppStore.persist.hasHydrated(), true);
  console.log('PASS: invalid JSON, blocked storage, quota exhaustion and inaccessible localStorage');
}

verify().then(() => {
  console.log('SUCCESS: store and persistence regression scenarios passed.');
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
