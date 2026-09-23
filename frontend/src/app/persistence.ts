import { createJSONStorage } from 'zustand/middleware';
import type { Task } from '../types/task';
import type { Proposal } from '../types/proposal';
import type { Milestone } from '../types/milestone';
import { MILESTONE_TEMPLATES, TASK_FIELDS } from './constants.ts';
import { calculateRating, getReadinessLevel } from '../services/ratingService.ts';
import { safeLocalStorage, validateStoredState } from '../services/storageService.ts';
import type { PersistedAppState } from '../services/storageService.ts';

// Compatibility surface for platform-core; validation and persistence have one implementation.
export { taskSchema, teamSchema, proposalSchema, proposalStatusSchema, milestoneSchema } from '../services/storageService.ts';
export type StoredAppState = PersistedAppState;
export const confirmableFields = TASK_FIELDS.map(field => field.key);

export function rateTask(task: Task): Task {
  const rating = calculateRating(task).total;
  return { ...task, tags: [...task.tags], confirmedFields: [...task.confirmedFields], rating, readinessLevel: getReadinessLevel(rating) };
}

/** Four explicit acceptance stages per selected task/team, preserving completed history. */
export function ensureStarterMilestones(proposals: Proposal[], milestones: Milestone[]): Milestone[] {
  const result = [...milestones];
  for (const proposal of proposals.filter(item => item.status === 'selected')) {
    for (const [index, template] of MILESTONE_TEMPLATES.entries()) {
      if (result.some(item => item.taskId === proposal.taskId && item.teamId === proposal.teamId && item.title === template.title)) continue;
      const baseId = 'ms-' + proposal.id + '-' + index;
      let milestoneId = baseId;
      let suffix = 1;
      while (result.some(item => item.id === milestoneId)) milestoneId = baseId + '-' + suffix++;
      result.push({ ...template, id: milestoneId, taskId: proposal.taskId, teamId: proposal.teamId, status: 'pending' });
    }
  }
  return result;
}

export function restoreState(value: unknown, fallback: StoredAppState): StoredAppState {
  return validateStoredState(value) ?? fallback;
}

export const safeStorage = createJSONStorage<StoredAppState>(() => safeLocalStorage)!;
