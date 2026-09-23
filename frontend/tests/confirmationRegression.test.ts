import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { useAppStore } from '../src/app/store.ts';
import { TASK_FIELDS } from '../src/app/constants.ts';
import { createEmptyTask, demoAnswers, seedProposals } from '../src/data/syntheticData.ts';
import { calculateRating } from '../src/services/ratingService.ts';
import { validateStoredState } from '../src/services/storageService.ts';
import type { Task } from '../src/types/task.ts';
import type { Proposal } from '../src/types/proposal.ts';

const state = () => useAppStore.getState();
beforeEach(() => state().resetDemo());

test('filled fields earn points only after business confirmation, including after restoration', () => {
  const card = { ...createEmptyTask(), ...demoAnswers };
  assert.equal(calculateRating(card).total, 0);
  state().addTask(card);
  const saved = () => state().tasks.find(task => task.id === card.id)!;
  assert.equal(saved().rating, 0);
  assert.equal(state().publishTask(card.id), false);
  assert.equal(state().confirmTask(card.id), true);
  assert.equal(saved().rating, 100);
  assert.equal(state().publishTask(card.id), true);

  state().updateTask({ ...saved(), availableData: '' });
  assert.equal(saved().rating, 0);
  assert.equal(saved().confirmed, false);
  assert.equal(saved().published, false);
  const restored = validateStoredState(JSON.parse(JSON.stringify(state())));
  assert.equal(restored?.tasks.find(task => task.id === card.id)?.rating, 0);
  assert.equal(state().confirmTask(card.id), true);
  assert.equal(saved().rating, 80);
  assert.equal(state().publishTask(card.id), true);
});

test('confirmation cannot award unconfirmed fields or duplicate field entries', () => {
  const card = { ...createEmptyTask(), ...demoAnswers, confirmed: true, confirmedFields: ['context', 'context', 'contact', 'unknown'] };
  const score = calculateRating(card);
  assert.equal(score.contextNeed, 10);
  assert.equal(score.businessCommunication, 5);
  assert.equal(score.total, 15);
  assert.equal(calculateRating({ ...card, confirmed: false }).total, 0);
  assert.equal(calculateRating({ ...card, confirmedFields: TASK_FIELDS.map(field => field.key), availableData: 'Не указано' }).total, 80);
});

test('malformed task, proposal and role inputs leave store usable and unchanged', () => {
  const tasksBefore = JSON.stringify(state().tasks);
  assert.doesNotThrow(() => state().addTask({ id: 'broken' } as Task));
  assert.doesNotThrow(() => state().updateTask({ ...state().tasks[0], context: null } as unknown as Task));
  assert.equal(JSON.stringify(state().tasks), tasksBefore);
  state().setActiveRole('invalid' as 'business');
  assert.equal(state().activeRole, 'business');
  state().setActiveRole('student');
  state().setActiveTeam('team-neuralforge');
  const proposalsBefore = JSON.stringify(state().proposals);
  assert.equal(state().addProposal({ ...seedProposals[0], id: 'broken', taskId: 'task-logistics', idea: null } as unknown as Proposal), false);
  assert.equal(JSON.stringify(state().proposals), proposalsBefore);
});
