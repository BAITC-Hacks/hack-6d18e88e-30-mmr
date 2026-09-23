import { z } from 'zod';
import type { PersistStorage, StateStorage } from 'zustand/middleware';
import type { Task } from '../types/task';
import type { Team } from '../types/team';
import type { Proposal } from '../types/proposal';
import type { Milestone } from '../types/milestone';
import { calculateRating, getReadinessLevel } from '../services/ratingService';
import { seedTeams } from '../data/syntheticData';
import { MILESTONE_TEMPLATES } from './constants';

export const STORAGE_KEY = 'ai-sana-taskrank-v1';
export const STORAGE_VERSION = 2;
const LEGACY_UI_KEY = 'ai-sana-demo';
export const pages = ['overview', 'builder', 'tasks', 'proposals', 'catalog', 'recommendations', 'my-proposals', 'team', 'inspector'] as const;
export type AppPage = typeof pages[number];
export interface ActivityEvent { id: string; title: string; detail?: string; createdAt: string }
export interface StoredAppState {
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
export type PersistedAppState = StoredAppState;
export const businessPages: readonly AppPage[] = ['overview', 'builder', 'tasks', 'proposals', 'catalog', 'inspector'];
export const studentPages: readonly AppPage[] = ['catalog', 'recommendations', 'my-proposals', 'team', 'inspector'];

const id = z.string().refine(value => value.trim().length > 0);
const timestamp = z.iso.datetime({ offset: true });
const strings = z.array(z.string());
const points = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const taskSchema = z.object({
  id, rawDraft: z.string().optional(), fieldSources: z.record(z.string(), z.enum(['draft', 'clarification', 'manual'])).optional(),
  title: z.string(), industry: z.string(), tags: strings,
  context: z.string(), need: z.string(), targetUsers: z.string(), availableData: z.string(),
  constraints: z.string(), expectedResult: z.string(), successCriteria: z.string(), contact: z.string(), consultationFormat: z.string(),
  confirmedFields: strings, rating: z.number(), readinessLevel: z.enum(['draft', 'working', 'ready', 'priority']),
  confirmed: z.boolean(), published: z.boolean(), createdAt: timestamp, updatedAt: timestamp,
});
const teamSchema = z.object({
  id, name: z.string(), description: z.string(), skills: strings,
  technologies: strings, interests: strings, industries: strings, progressPoints: points,
});
export const proposalStatusSchema = z.enum(['pending', 'selected', 'rejected']);
export const proposalSchema = z.object({
  id, taskId: id, teamId: id, idea: id, implementationPlan: id, estimatedTime: id,
  prototypeUrl: z.string(), status: proposalStatusSchema, createdAt: timestamp,
});
export const milestoneSchema = z.object({
  id, taskId: id, teamId: id, title: id, description: z.string(),
  status: z.enum(['pending', 'completed']), points, confirmedAt: timestamp.optional(),
});
const eventSchema = z.object({ id, title: id, detail: z.string().optional(), createdAt: timestamp });
const stateSchema = z.object({
  tasks: z.array(taskSchema), teams: z.array(teamSchema), proposals: z.array(proposalSchema), milestones: z.array(milestoneSchema),
  activeRole: z.enum(['business', 'student']), activeTeamId: id.nullable(), activeTaskId: id.nullable(),
  page: z.enum(pages).default('overview'), demoEnabled: z.boolean().default(true),
  demoStep: z.number().int().min(0).max(8).default(0), events: z.array(eventSchema).default([]),
});
export const confirmableFields = [
  'title', 'context', 'need', 'targetUsers', 'availableData', 'constraints',
  'expectedResult', 'successCriteria', 'contact', 'consultationFormat',
] as const satisfies readonly (keyof Task)[];

export function isSafePrototypeUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function rateTask(task: Task): Task {
  const confirmedFields = confirmableFields.filter(field => task.confirmedFields.includes(field) && task[field].trim().length > 0);
  const confirmed = task.confirmed && [task.title, task.context, task.need].every(value => value.trim().length > 0);
  const normalized = { ...task, confirmed, published: task.published && confirmed,
    tags: [...new Set(task.tags.map(tag => tag.trim()).filter(Boolean))], confirmedFields,
    ...(task.fieldSources ? { fieldSources: { ...task.fieldSources } } : {}),
  };
  const { total } = calculateRating(normalized);
  return { ...normalized, rating: total, readinessLevel: getReadinessLevel(total) };
}

/** Existing project history is retained, including the original single 50-point milestone. */
export function ensureStarterMilestones(proposals: Proposal[], milestones: Milestone[]): Milestone[] {
  const result = [...milestones];
  for (const proposal of proposals) {
    if (proposal.status !== 'selected' || result.some(item => item.taskId === proposal.taskId && item.teamId === proposal.teamId)) continue;
    for (const [index, template] of MILESTONE_TEMPLATES.entries()) {
      const baseId = `ms-${proposal.id}-${index}`;
      let milestoneId = baseId;
      let suffix = 1;
      while (result.some(item => item.id === milestoneId)) milestoneId = `${baseId}-${suffix++}`;
      result.push({ ...template, id: milestoneId, taskId: proposal.taskId, teamId: proposal.teamId, status: 'pending' });
    }
  }
  return result;
}

function validUniqueItems<T extends { id: string }>(value: unknown, schema: z.ZodType<T>, fallback: T[]): T[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
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

/** Salvage valid records; never spread persisted keys over live store actions. */
export function restoreState(value: unknown, fallback: StoredAppState, addMissingSeeds = false): StoredAppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const data = value as Record<string, unknown>;
  const tasks = validUniqueItems(data.tasks, taskSchema, fallback.tasks).map(task => rateTask({ ...task, published: task.published && task.confirmed }));
  const teams = validUniqueItems(data.teams, teamSchema, fallback.teams);
  const proposals = validUniqueItems(data.proposals, proposalSchema, fallback.proposals);
  if (addMissingSeeds) {
    for (const task of fallback.tasks) if (!tasks.some(item => item.id === task.id)) tasks.push(rateTask(task));
    for (const team of fallback.teams) if (!teams.some(item => item.id === team.id)) teams.push(structuredClone(team));
    for (const proposal of fallback.proposals) if (!proposals.some(item => item.id === proposal.id)) proposals.push({ ...proposal });
  }
  const taskIds = new Set(tasks.map(task => task.id));
  const teamIds = new Set(teams.map(team => team.id));
  const hasReferences = (item: { taskId: string; teamId: string }) => taskIds.has(item.taskId) && teamIds.has(item.teamId);
  const validProposals = proposals.filter(item => hasReferences(item) && isSafePrototypeUrl(item.prototypeUrl));
  const milestones = ensureStarterMilestones(validProposals,
    validUniqueItems(data.milestones, milestoneSchema, fallback.milestones).filter(item => hasReferences(item)
      && (item.status !== 'completed' || Boolean(item.confirmedAt))),
  );
  // Seed points describe historical progress outside this demo. Add only the
  // current completed ledger, preserving both branches without trusting stale totals.
  for (const team of teams) {
    const baseline = seedTeams.find(seed => seed.id === team.id)?.progressPoints ?? 0;
    const total = milestones.filter(item => item.teamId === team.id && item.status === 'completed').reduce((sum, item) => sum + item.points, baseline);
    team.progressPoints = Number.isSafeInteger(total) ? total : baseline;
  }
  const activeRole = data.activeRole === 'business' || data.activeRole === 'student' ? data.activeRole : fallback.activeRole;
  const allowed = activeRole === 'business' ? businessPages : studentPages;
  const selectedTask = data.activeTaskId === null ? null :
    typeof data.activeTaskId === 'string' && taskIds.has(data.activeTaskId) ? data.activeTaskId : tasks[0]?.id ?? null;
  return {
    tasks, teams, proposals: validProposals, milestones, activeRole,
    activeTeamId: data.activeTeamId === null ? null :
      typeof data.activeTeamId === 'string' && teamIds.has(data.activeTeamId) ? data.activeTeamId : teams[0]?.id ?? null,
    activeTaskId: activeRole === 'student' && !tasks.find(task => task.id === selectedTask)?.published ? null : selectedTask,
    page: allowed.includes(data.page as AppPage) ? data.page as AppPage : activeRole === 'business' ? 'overview' : 'catalog',
    demoEnabled: typeof data.demoEnabled === 'boolean' ? data.demoEnabled : fallback.demoEnabled,
    demoStep: typeof data.demoStep === 'number' && Number.isFinite(data.demoStep) ? Math.max(0, Math.min(8, Math.trunc(data.demoStep))) : fallback.demoStep,
    events: validUniqueItems(data.events, eventSchema, fallback.events).slice(0, 80),
  };
}

export function validateStoredState(value: unknown): StoredAppState | null {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) return null;
  const state = parsed.data;
  if (![state.tasks, state.teams, state.proposals, state.milestones, state.events].every(items => new Set(items.map(item => item.id)).size === items.length)) return null;
  const taskIds = new Set(state.tasks.map(task => task.id));
  const teamIds = new Set(state.teams.map(team => team.id));
  if (state.activeTeamId && !teamIds.has(state.activeTeamId)) return null;
  if (state.activeTaskId && !taskIds.has(state.activeTaskId)) return null;
  if (state.tasks.some(task => task.published && !task.confirmed)) return null;
  if (state.proposals.some(item => !taskIds.has(item.taskId) || !teamIds.has(item.teamId) || !isSafePrototypeUrl(item.prototypeUrl))) return null;
  if (state.milestones.some(item => !taskIds.has(item.taskId) || !teamIds.has(item.teamId) || (item.status === 'completed' && !item.confirmedAt))) return null;
  return restoreState(state, state);
}

let lastStorageError: string | null = null;
const observedStorage = new Map<string, string | null>();
export const getStorageError = () => lastStorageError;
export const clearStorageError = () => { lastStorageError = null; };

/** Only an explicit reset may replace a newer snapshot from another tab. */
export function rebaseStorageSnapshot(name = STORAGE_KEY): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') observedStorage.set(name, globalThis.localStorage.getItem(name));
  } catch { /* The normal write reports storage denial while keeping the in-memory demo usable. */ }
}

export const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      if (typeof globalThis.localStorage === 'undefined') return null;
      const raw = globalThis.localStorage.getItem(name);
      observedStorage.set(name, raw);
      if (!raw) return null;
      const envelope: unknown = JSON.parse(raw);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !('state' in envelope)) throw new Error('Invalid save');
      const version = 'version' in envelope ? envelope.version : 0;
      if (typeof version !== 'number' || ![0, 1, STORAGE_VERSION].includes(version)) throw new Error('Unsupported save version');
      return raw;
    } catch {
      lastStorageError = 'Не удалось прочитать сохранение. Приложение продолжает работать с доступными данными.';
      return null;
    }
  },
  setItem(name, value) {
    try {
      if (typeof globalThis.localStorage === 'undefined') throw new Error('Storage unavailable');
      // localStorage is shared, but each tab has its own live store. An unrelated
      // action (even navigation/toast dismissal) must not save a stale full snapshot.
      if (globalThis.localStorage.getItem(name) !== (observedStorage.get(name) ?? null)) {
        lastStorageError = 'Данные изменены в другой вкладке. Текущие изменения остаются в памяти. Скопируйте нужный текст и перезагрузите страницу, чтобы загрузить актуальное сохранение.';
        return;
      }
      globalThis.localStorage.setItem(name, value);
      observedStorage.set(name, value);
      lastStorageError = null;
    }
    catch { lastStorageError = 'Браузер не разрешает сохранение. Изменения доступны до перезагрузки страницы.'; }
  },
  removeItem(name) {
    try { if (typeof globalThis.localStorage !== 'undefined') { globalThis.localStorage.removeItem(name); observedStorage.set(name, null); } }
    catch { lastStorageError = 'Браузер не разрешает очистить сохранение.'; }
  },
};

export const safeStorage: PersistStorage<StoredAppState> = {
  getItem(name) {
    const raw = safeLocalStorage.getItem(name) ?? (name === STORAGE_KEY ? safeLocalStorage.getItem(LEGACY_UI_KEY) : null);
    if (typeof raw !== 'string') return null;
    const envelope = JSON.parse(raw) as { state: StoredAppState; version?: number };
    return { state: envelope.state, version: envelope.version ?? 0 };
  },
  setItem(name, value) { safeLocalStorage.setItem(name, JSON.stringify(value)); },
  removeItem(name) { safeLocalStorage.removeItem(name); },
};
