import { z } from 'zod';
import type { StateStorage } from 'zustand/middleware';
import type { Task } from '../types/task';
import type { Team } from '../types/team';
import type { Proposal } from '../types/proposal';
import type { Milestone } from '../types/milestone';
import { MILESTONE_TEMPLATES } from '../app/constants.ts';
import { calculateRating, getReadinessLevel } from './ratingService.ts';

export const STORAGE_KEY = 'ai-sana-demo';
export const STORAGE_VERSION = 1;
export type AppPage = 'overview' | 'builder' | 'tasks' | 'proposals' | 'catalog' | 'recommendations' | 'my-proposals' | 'team' | 'inspector';
export interface ActivityEvent { id: string; title: string; detail?: string; createdAt: string }
export interface PersistedAppState {
  tasks: Task[];
  teams: Team[];
  proposals: Proposal[];
  milestones: Milestone[];
  activeRole: 'business' | 'student';
  activeTeamId: string | null;
  activeTaskId: string | null;
  page: AppPage;
  demoEnabled: boolean;
  demoStep: number;
  events: ActivityEvent[];
}

const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
const text = z.string();
const id = z.string().refine(value => value.trim().length > 0);
export const taskSchema = z.object({
  id, rawDraft: text.optional(), fieldSources: z.record(text, z.enum(['draft', 'clarification', 'manual'])).optional(),
  title: text, industry: text, tags: z.array(text), context: text, need: text, targetUsers: text,
  availableData: text, constraints: text, expectedResult: text, successCriteria: text,
  contact: text, consultationFormat: text, confirmedFields: z.array(text),
  rating: z.number().min(0).max(100), readinessLevel: z.enum(['draft', 'working', 'ready', 'priority']),
  confirmed: z.boolean(), published: z.boolean(), createdAt: date, updatedAt: date,
});
export const teamSchema = z.object({
  id, name: text, description: text, skills: z.array(text), technologies: z.array(text),
  interests: z.array(text), industries: z.array(text), progressPoints: z.number().int().nonnegative(),
});
export const proposalStatusSchema = z.enum(['pending', 'selected', 'rejected']);
export const proposalSchema = z.object({
  id, taskId: id, teamId: id, idea: text, implementationPlan: text, estimatedTime: text,
  prototypeUrl: text, status: proposalStatusSchema, createdAt: date,
});
export const milestoneSchema = z.object({
  id, taskId: id, teamId: id, title: text, description: text,
  status: z.enum(['pending', 'completed']), points: z.number().int().nonnegative(), confirmedAt: date.optional(),
});
const stateSchema = z.object({
  tasks: z.array(taskSchema), teams: z.array(teamSchema), proposals: z.array(proposalSchema), milestones: z.array(milestoneSchema),
  activeRole: z.enum(['business', 'student']), activeTeamId: id.nullable(), activeTaskId: id.nullable(),
  page: z.enum(['overview', 'builder', 'tasks', 'proposals', 'catalog', 'recommendations', 'my-proposals', 'team', 'inspector']),
  demoEnabled: z.boolean(), demoStep: z.number().int().min(0).max(8),
  events: z.array(z.object({ id, title: text, detail: text.optional(), createdAt: date })),
});

const uniqueIds = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;

export function isSafePrototypeUrl(value: string): boolean {
  if (!value.trim()) return true;
  try { return ['http:', 'https:'].includes(new URL(value.trim()).protocol); }
  catch { return false; }
}

export function validateStoredState(value: unknown): PersistedAppState | null {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) return null;
  const state = parsed.data;
  if (![state.tasks, state.teams, state.proposals, state.milestones, state.events].every(uniqueIds)) return null;
  const taskIds = new Set(state.tasks.map(task => task.id));
  const teamIds = new Set(state.teams.map(team => team.id));
  if (state.activeTeamId && !teamIds.has(state.activeTeamId)) return null;
  if (state.activeTaskId && !taskIds.has(state.activeTaskId)) return null;
  const pairs = state.proposals.map(proposal => `${proposal.taskId}\u0000${proposal.teamId}`);
  if (new Set(pairs).size !== pairs.length) return null;
  if (state.proposals.some(proposal => !taskIds.has(proposal.taskId) || !teamIds.has(proposal.teamId) || !isSafePrototypeUrl(proposal.prototypeUrl))) return null;
  if (state.tasks.some(task => (task.published && !task.confirmed)
    || (task.confirmed && (!task.title.trim() || !task.context.trim() || !task.need.trim())))) return null;
  const milestones = state.milestones.map(milestone => `${milestone.taskId}\u0000${milestone.teamId}\u0000${milestone.title}`);
  if (new Set(milestones).size !== milestones.length) return null;
  if (state.milestones.some(milestone =>
    !state.proposals.some(proposal => proposal.taskId === milestone.taskId && proposal.teamId === milestone.teamId && proposal.status === 'selected')
    || !MILESTONE_TEMPLATES.some(template => template.title === milestone.title && template.points === milestone.points)
    || (milestone.status === 'completed' && !milestone.confirmedAt)
  )) return null;
  if (state.proposals.some(proposal => proposal.status === 'selected'
    && state.milestones.filter(milestone => milestone.taskId === proposal.taskId && milestone.teamId === proposal.teamId).length !== MILESTONE_TEMPLATES.length)) return null;
  for (const task of state.tasks) {
    task.rating = calculateRating(task).total;
    task.readinessLevel = getReadinessLevel(task.rating);
  }
  for (const team of state.teams) {
    team.progressPoints = state.milestones.filter(milestone => milestone.teamId === team.id && milestone.status === 'completed')
      .reduce((sum, milestone) => sum + milestone.points, 0);
  }
  const studentPages: AppPage[] = ['catalog', 'recommendations', 'my-proposals', 'team', 'inspector'];
  const businessPages: AppPage[] = ['overview', 'builder', 'tasks', 'proposals', 'catalog', 'inspector'];
  if (!(state.activeRole === 'business' ? businessPages : studentPages).includes(state.page)) {
    state.page = state.activeRole === 'business' ? 'overview' : 'catalog';
  }
  if (state.activeRole === 'student' && state.activeTaskId && !state.tasks.find(task => task.id === state.activeTaskId)?.published) state.activeTaskId = null;
  return state;
}

let lastStorageError: string | null = null;
export const getStorageError = () => lastStorageError;
export const clearStorageError = () => { lastStorageError = null; };

// Private mode, quota limits and corrupted saves must never break the app.
export const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const envelope: unknown = JSON.parse(raw);
      if (!envelope || typeof envelope !== 'object' || !('version' in envelope) || envelope.version !== STORAGE_VERSION || !('state' in envelope)) {
        lastStorageError = 'Сохранение несовместимо с этой версией. Восстановлены демонстрационные данные.';
        return null;
      }
      const validated = validateStoredState(envelope.state);
      if (!validated) {
        lastStorageError = 'Сохранённые данные повреждены. Восстановлены демонстрационные данные.';
        return null;
      }
      return JSON.stringify({ state: validated, version: STORAGE_VERSION });
    } catch {
      lastStorageError = 'Не удалось прочитать сохранение. Приложение работает с демонстрационными данными.';
      return null;
    }
  },
  setItem(name, value) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(name, value);
    } catch {
      lastStorageError = 'Браузер не разрешает сохранение. Изменения доступны до перезагрузки страницы.';
    }
  },
  removeItem(name) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(name);
    } catch {
      lastStorageError = 'Браузер не разрешает очистить сохранение.';
    }
  },
};
