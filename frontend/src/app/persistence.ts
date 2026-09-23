import { z } from 'zod';
import type { PersistStorage } from 'zustand/middleware';
import type { Task } from '../types/task';
import type { Team } from '../types/team';
import type { Proposal } from '../types/proposal';
import type { Milestone } from '../types/milestone';
import { calculateRating, getReadinessLevel } from '../services/ratingService';

export interface StoredAppState {
  tasks: Task[];
  teams: Team[];
  proposals: Proposal[];
  milestones: Milestone[];
  activeRole: 'business' | 'student';
  activeTeamId: string | null;
  activeTaskId: string | null;
}

const id = z.string().refine((value) => value.trim().length > 0);
const strings = z.array(z.string());
const points = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const taskSchema = z.object({
  id, title: z.string(), industry: z.string(), tags: strings,
  context: z.string(), need: z.string(), targetUsers: z.string(),
  availableData: z.string(), constraints: z.string(), expectedResult: z.string(),
  successCriteria: z.string(), contact: z.string(), consultationFormat: z.string(),
  confirmedFields: strings, rating: z.number(),
  readinessLevel: z.enum(['draft', 'working', 'ready', 'priority']),
  confirmed: z.boolean(), published: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(),
});

const teamSchema = z.object({
  id, name: z.string(), description: z.string(), skills: strings,
  technologies: strings, interests: strings, industries: strings, progressPoints: points,
});

export const proposalStatusSchema = z.enum(['pending', 'selected', 'rejected']);
export const proposalSchema = z.object({
  id, taskId: id, teamId: id, idea: z.string(), implementationPlan: z.string(),
  estimatedTime: z.string(), prototypeUrl: z.string(),
  status: proposalStatusSchema, createdAt: z.string(),
});

export const milestoneSchema = z.object({
  id, taskId: id, teamId: id, title: z.string(), description: z.string(),
  status: z.enum(['pending', 'completed']), points, confirmedAt: z.string().optional(),
});

export const confirmableFields = [
  'title', 'context', 'need', 'targetUsers', 'availableData', 'constraints',
  'expectedResult', 'successCriteria', 'contact', 'consultationFormat',
] as const satisfies readonly (keyof Task)[];

export function rateTask(task: Task): Task {
  const confirmedFields = confirmableFields.filter(
    (field) => task.confirmedFields.includes(field) && task[field].trim().length > 0,
  );
  const normalized = { ...task, tags: [...task.tags], confirmedFields };
  const { total } = calculateRating(normalized);
  return { ...normalized, rating: total, readinessLevel: getReadinessLevel(total) };
}

/** Selected teams get a demo milestone; completed history prevents recreating it. */
export function ensureStarterMilestones(proposals: Proposal[], milestones: Milestone[]): Milestone[] {
  const result = [...milestones];
  for (const proposal of proposals) {
    if (proposal.status !== 'selected' || result.some(
      (milestone) => milestone.taskId === proposal.taskId && milestone.teamId === proposal.teamId,
    )) continue;
    const baseId = `ms-${proposal.id}`;
    let milestoneId = baseId;
    let suffix = 1;
    while (result.some((milestone) => milestone.id === milestoneId)) {
      milestoneId = `${baseId}-${suffix++}`;
    }
    result.push({
      id: milestoneId, taskId: proposal.taskId, teamId: proposal.teamId,
      title: 'Этап 1: Архитектура решения и MVP прототип',
      description: 'Согласование спецификации и первая демонстрация прототипа заказчику',
      status: 'pending', points: 50,
    });
  }
  return result;
}

function validUniqueItems<T extends { id: string }>(value: unknown, schema: z.ZodType<T>, fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of value) {
    const parsed = schema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    result.push(parsed.data);
  }
  return result;
}

/** Only data is restored: persisted keys can never replace store actions. */
export function restoreState(value: unknown, fallback: StoredAppState): StoredAppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const data = value as Record<string, unknown>;
  const tasks = validUniqueItems(data.tasks, taskSchema, fallback.tasks).map((task) =>
    rateTask({ ...task, published: task.published && task.confirmed }),
  );
  const teams = validUniqueItems(data.teams, teamSchema, fallback.teams);
  const taskIds = new Set(tasks.map((task) => task.id));
  const teamIds = new Set(teams.map((team) => team.id));
  const hasReferences = (item: { taskId: string; teamId: string }) =>
    taskIds.has(item.taskId) && teamIds.has(item.teamId);
  const proposals = validUniqueItems(data.proposals, proposalSchema, fallback.proposals).filter(hasReferences);
  const milestones = ensureStarterMilestones(proposals,
    validUniqueItems(data.milestones, milestoneSchema, fallback.milestones).filter(hasReferences),
  );
  return {
    tasks, teams, proposals, milestones,
    activeRole: data.activeRole === 'business' || data.activeRole === 'student' ? data.activeRole : fallback.activeRole,
    activeTeamId: data.activeTeamId === null ? null :
      typeof data.activeTeamId === 'string' && teamIds.has(data.activeTeamId) ? data.activeTeamId : teams[0]?.id ?? null,
    activeTaskId: data.activeTaskId === null ? null :
      typeof data.activeTaskId === 'string' && taskIds.has(data.activeTaskId) ? data.activeTaskId : tasks[0]?.id ?? null,
  };
}

/** Private browsing, quota errors and malformed JSON must not break the demo. */
export const safeStorage: PersistStorage<StoredAppState> = {
  getItem(name) {
    try {
      const raw = globalThis.localStorage.getItem(name);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value) || !('state' in value)) return null;
      return value as { state: StoredAppState; version?: number };
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try { globalThis.localStorage.setItem(name, JSON.stringify(value)); } catch { /* Keep the working in-memory state. */ }
  },
  removeItem(name) {
    try { globalThis.localStorage.removeItem(name); } catch { /* Storage may be unavailable. */ }
  },
};
