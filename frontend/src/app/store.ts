import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task } from '../types/task';
import type { Proposal, ProposalStatus } from '../types/proposal';
import type { Milestone } from '../types/milestone';
import { seedTasks, seedTeams, seedProposals } from '../data/syntheticData';
import {
  businessPages, studentPages, confirmableFields, ensureStarterMilestones, milestoneSchema,
  proposalSchema, proposalStatusSchema, rateTask, restoreState, safeStorage, taskSchema,
  clearStorageError, getStorageError, isSafePrototypeUrl, rebaseStorageSnapshot, STORAGE_KEY, STORAGE_VERSION,
  type StoredAppState, type ActivityEvent, type AppPage,
} from './persistence';

export type { ActivityEvent, AppPage };
export type Page = AppPage;
export interface AppState extends StoredAppState {
  toast: string | null;
  storageError: string | null;
  navigate: (page: AppPage) => void;
  setActiveRole: (role: 'business' | 'student') => void;
  setActiveTeam: (teamId: string | null) => void;
  setActiveTask: (taskId: string | null) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  confirmTask: (taskId: string) => boolean;
  publishTask: (taskId: string) => boolean;
  addProposal: (proposal: Proposal) => boolean;
  setProposalDecision: (proposalId: string, status: ProposalStatus) => boolean;
  selectProposal: (proposalId: string) => boolean;
  rejectProposal: (proposalId: string) => boolean;
  addMilestone: (milestone: Milestone) => boolean;
  confirmMilestone: (milestoneId: string) => boolean;
  resetToSeedData: () => void;
  resetDemo: () => void;
  setDemoEnabled: (enabled: boolean) => void;
  setDemoStep: (step: number) => void;
  notify: (message: string | null) => void;
  recordEvent: (title: string, detail?: string) => void;
}

function initialData(): StoredAppState {
  return {
    tasks: seedTasks.map(rateTask), teams: structuredClone(seedTeams), proposals: structuredClone(seedProposals),
    milestones: ensureStarterMilestones(seedProposals, []), activeRole: 'business',
    activeTeamId: seedTeams.find(team => team.id === 'team-neuralforge')?.id ?? seedTeams[0]?.id ?? null,
    activeTaskId: null, page: 'overview', demoEnabled: true, demoStep: 0,
    events: [{ id: 'demo-start', title: 'Демонстрационные данные готовы',
      detail: `${seedTasks.length} задач · ${seedTeams.length} команд · ${seedProposals.length} откликов`, createdAt: new Date().toISOString() }],
  };
}
const withEvent = (state: AppState, title: string, detail?: string): ActivityEvent[] =>
  [{ id: crypto.randomUUID(), title, detail, createdAt: new Date().toISOString() }, ...state.events].slice(0, 80);
function isSelected(state: AppState, taskId: string, teamId: string): boolean {
  return state.tasks.some(task => task.id === taskId) && state.teams.some(team => team.id === teamId)
    && state.proposals.some(proposal => proposal.taskId === taskId && proposal.teamId === teamId && proposal.status === 'selected');
}

export const useAppStore = create<AppState>()(persist((set, get) => {
  const commit = (update: Partial<AppState>) => {
    set(update);
    const storageError = getStorageError();
    if (storageError !== get().storageError) set({ storageError });
  };
  const deny = (message: string) => { commit({ toast: message }); return false; };
  const business = () => get().activeRole === 'business';
  const reset = () => {
    clearStorageError();
    rebaseStorageSnapshot();
    commit({ ...initialData(), toast: 'Демонстрационные данные восстановлены.', storageError: null });
  };
  return {
    ...initialData(), toast: null, storageError: getStorageError(),
    navigate(page) {
      if ((business() ? businessPages : studentPages).includes(page)) commit({ page });
    },
    setActiveRole(activeRole) {
      if (activeRole === 'business' || activeRole === 'student') commit({ activeRole, page: activeRole === 'business' ? 'overview' : 'catalog', activeTaskId: null });
    },
    setActiveTeam(activeTeamId) {
      if (activeTeamId === null || get().teams.some(team => team.id === activeTeamId)) commit({ activeTeamId });
    },
    setActiveTask(activeTaskId) {
      if (activeTaskId === null || get().tasks.some(task => task.id === activeTaskId && (business() || task.published))) commit({ activeTaskId });
    },
    addTask(task) {
      if (!business()) { deny('Создавать задачи может только бизнес.'); return; }
      const parsed = taskSchema.safeParse(task);
      if (!parsed.success) { deny('Проверьте поля карточки задачи.'); return; }
      const state = get();
      if (state.tasks.some(item => item.id === parsed.data.id)) { deny('Такая задача уже существует.'); return; }
      const draft = rateTask({ ...parsed.data, confirmedFields: [], confirmed: false, published: false });
      commit({ tasks: [draft, ...state.tasks], activeTaskId: draft.id, events: withEvent(state, 'Задача создана', draft.title || 'Новый черновик') });
    },
    updateTask(task) {
      if (!business()) { deny('Редактировать задачи может только бизнес.'); return; }
      const parsed = taskSchema.safeParse(task);
      if (!parsed.success) { deny('Проверьте поля карточки задачи.'); return; }
      const state = get();
      const previous = state.tasks.find(item => item.id === parsed.data.id);
      if (!previous) return;
      const changed = confirmableFields.some(field => previous[field] !== parsed.data[field])
        || previous.industry !== parsed.data.industry || previous.rawDraft !== parsed.data.rawDraft
        || JSON.stringify(previous.tags) !== JSON.stringify(parsed.data.tags);
      const updated = rateTask({
        ...parsed.data,
        // Retain approvals for unchanged values, never for copied or newly added values.
        confirmedFields: previous.confirmedFields.filter(field =>
          confirmableFields.some(key => key === field && previous[key] === parsed.data[key]) && parsed.data.confirmedFields.includes(field)),
        confirmed: changed ? false : previous.confirmed, published: changed ? false : previous.published,
        createdAt: previous.createdAt, updatedAt: new Date().toISOString(),
      });
      commit({ tasks: state.tasks.map(item => item.id === updated.id ? updated : item),
        ...(changed && previous.confirmed ? { toast: 'Карточка изменена. Подтвердите данные повторно перед публикацией.' } : {}),
      });
    },
    confirmTask(taskId) {
      if (!business()) return deny('Подтверждать данные может только бизнес.');
      const state = get();
      const task = state.tasks.find(item => item.id === taskId);
      if (!task) return false;
      if (![task.title, task.context, task.need].every(value => value.trim())) return deny('Заполните название, контекст и потребность перед подтверждением.');
      const updated = rateTask({ ...task, confirmed: true,
        confirmedFields: confirmableFields.filter(field => task[field].trim().length > 0), updatedAt: new Date().toISOString() });
      commit({ tasks: state.tasks.map(item => item.id === taskId ? updated : item), toast: 'Карточка подтверждена бизнесом.',
        events: withEvent(state, 'Карточка подтверждена', `${task.rating} → ${updated.rating} · ${task.title}`) });
      return true;
    },
    publishTask(taskId) {
      if (!business()) return deny('Публиковать задачи может только бизнес.');
      const state = get();
      const task = state.tasks.find(item => item.id === taskId);
      if (!task) return false;
      if (!task.confirmed) return deny('Сначала подтвердите корректность карточки.');
      if (task.published) return true;
      commit({ tasks: state.tasks.map(item => item.id === taskId ? { ...item, published: true, updatedAt: new Date().toISOString() } : item),
        toast: 'Задача опубликована и доступна всем командам.', events: withEvent(state, 'Задача опубликована', task.title) });
      return true;
    },
    addProposal(proposal) {
      const parsed = proposalSchema.safeParse(proposal);
      if (!parsed.success) return deny('Проверьте поля предложения.');
      const state = get();
      if (state.activeRole !== 'student') return deny('Переключитесь в роль студента, чтобы отправить отклик.');
      if (parsed.data.teamId !== state.activeTeamId || !state.teams.some(team => team.id === parsed.data.teamId)) return deny('Выберите активную команду.');
      const task = state.tasks.find(item => item.id === parsed.data.taskId);
      if (!task?.published) return deny('Отклик доступен только для опубликованной задачи.');
      if (state.proposals.some(item => item.id === parsed.data.id)) return deny('Предложение с таким ID уже существует.');
      if (![parsed.data.idea, parsed.data.implementationPlan, parsed.data.estimatedTime].every(value => value.trim())) return deny('Заполните идею, план и оценку сроков.');
      if (!isSafePrototypeUrl(parsed.data.prototypeUrl)) return deny('Укажите ссылку с https:// или http:// либо оставьте поле пустым.');
      const fresh: Proposal = { ...parsed.data, status: 'pending', createdAt: new Date().toISOString(),
        idea: parsed.data.idea.trim(), implementationPlan: parsed.data.implementationPlan.trim(), estimatedTime: parsed.data.estimatedTime.trim(), prototypeUrl: parsed.data.prototypeUrl.trim() };
      commit({ proposals: [fresh, ...state.proposals], toast: 'Предложение отправлено бизнесу.', events: withEvent(state, 'Команда отправила предложение', task.title) });
      return true;
    },
    setProposalDecision(proposalId, status) {
      if (!business()) return deny('Решение по предложению принимает бизнес.');
      if (!proposalStatusSchema.safeParse(status).success) return false;
      const state = get();
      const proposal = state.proposals.find(item => item.id === proposalId);
      if (!proposal || !state.tasks.some(task => task.id === proposal.taskId) || !state.teams.some(team => team.id === proposal.teamId)) return false;
      if (proposal.status === status) return true;
      const proposals = state.proposals.map(item => item.id === proposalId ? { ...item, status } : item);
      const title = status === 'selected' ? 'Бизнес выбрал команду' : status === 'rejected' ? 'Предложение отклонено' : 'Предложение возвращено на рассмотрение';
      commit({ proposals, milestones: ensureStarterMilestones(proposals, state.milestones), toast: title,
        events: withEvent(state, title, state.teams.find(team => team.id === proposal.teamId)?.name) });
      return true;
    },
    selectProposal(id) { return get().setProposalDecision(id, 'selected'); },
    rejectProposal(id) { return get().setProposalDecision(id, 'rejected'); },
    addMilestone(milestone) {
      if (!business()) return deny('Этапы согласует бизнес.');
      const parsed = milestoneSchema.safeParse(milestone);
      if (!parsed.success) return false;
      const state = get();
      if (state.milestones.some(item => item.id === parsed.data.id) || !isSelected(state, parsed.data.taskId, parsed.data.teamId)) return false;
      commit({ milestones: [...state.milestones, { ...parsed.data, status: 'pending', confirmedAt: undefined }] });
      return true;
    },
    confirmMilestone(id) {
      if (!business()) return deny('Выполнение этапа подтверждает бизнес.');
      const state = get();
      const milestone = state.milestones.find(item => item.id === id);
      if (!milestone || !isSelected(state, milestone.taskId, milestone.teamId)) return false;
      if (milestone.status === 'completed') return true;
      const team = state.teams.find(item => item.id === milestone.teamId)!;
      if (!Number.isSafeInteger(team.progressPoints + milestone.points)) return false;
      commit({
        milestones: state.milestones.map(item => item.id === id ? { ...item, status: 'completed', confirmedAt: new Date().toISOString() } : item),
        teams: state.teams.map(item => item.id === milestone.teamId ? { ...item, progressPoints: item.progressPoints + milestone.points } : item),
        toast: `Этап ${milestone.title} подтверждён. +${milestone.points} баллов команде.`,
        events: withEvent(state, `Этап ${milestone.title} подтверждён`, `${team.name} · +${milestone.points} баллов`),
      });
      return true;
    },
    resetToSeedData: reset, resetDemo: reset,
    setDemoEnabled(demoEnabled) { if (typeof demoEnabled === 'boolean') commit({ demoEnabled }); },
    setDemoStep(demoStep) { if (Number.isFinite(demoStep)) commit({ demoStep: Math.max(0, Math.min(8, Math.trunc(demoStep))) }); },
    notify(toast) { commit({ toast }); },
    recordEvent(title, detail) { commit({ events: withEvent(get(), title, detail) }); },
  };
}, {
  name: STORAGE_KEY, version: STORAGE_VERSION, storage: safeStorage,
  partialize: ({ tasks, teams, proposals, milestones, activeRole, activeTeamId, activeTaskId, page, demoEnabled, demoStep, events }) =>
    ({ tasks, teams, proposals, milestones, activeRole, activeTeamId, activeTaskId, page, demoEnabled, demoStep, events }),
  migrate: (persisted, version) => restoreState(persisted, initialData(), version < STORAGE_VERSION),
  merge: (persisted, current) => ({ ...current, ...restoreState(persisted, current), storageError: getStorageError() }),
}));
