import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Task } from '../types/task.ts';
import type { Proposal } from '../types/proposal.ts';
import { seedTasks, seedTeams, seedProposals } from '../data/syntheticData.ts';
import { calculateRating, getReadinessLevel } from '../services/ratingService.ts';
import { clearStorageError, getStorageError, isSafePrototypeUrl, safeLocalStorage, STORAGE_KEY, STORAGE_VERSION } from '../services/storageService.ts';
import type { ActivityEvent, AppPage, PersistedAppState } from '../services/storageService.ts';
import { MILESTONE_TEMPLATES, TASK_FIELDS } from './constants.ts';

export type { AppPage, ActivityEvent };
export type Page = AppPage;
export interface AppState extends PersistedAppState {
  toast: string | null;
  storageError: string | null;
  navigate: (page: AppPage) => void;
  setActiveRole: (role: 'business' | 'student') => void;
  setActiveTeam: (teamId: string | null) => void;
  setActiveTask: (taskId: string | null) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  addProposal: (proposal: Proposal) => boolean;
  confirmTask: (id: string) => boolean;
  publishTask: (id: string) => boolean;
  selectProposal: (id: string) => boolean;
  rejectProposal: (id: string) => boolean;
  confirmMilestone: (id: string) => boolean;
  resetDemo: () => void;
  setDemoEnabled: (enabled: boolean) => void;
  setDemoStep: (step: number) => void;
  notify: (message: string | null) => void;
  recordEvent: (title: string, detail?: string) => void;
}

function initialState(): PersistedAppState {
  return {
    tasks: structuredClone(seedTasks), teams: structuredClone(seedTeams), proposals: structuredClone(seedProposals),
    milestones: [], activeRole: 'business', activeTeamId: seedTeams[0].id, activeTaskId: null,
    page: 'overview', demoEnabled: true, demoStep: 0,
    events: [{ id: 'demo-start', title: 'Демонстрационные данные готовы', detail: '10 задач · 5 команд · 6 откликов', createdAt: new Date().toISOString() }],
  };
}
const event = (title: string, detail?: string): ActivityEvent => ({ id: crypto.randomUUID(), title, detail, createdAt: new Date().toISOString() });
const withEvent = (state: AppState, title: string, detail?: string) => [event(title, detail), ...state.events].slice(0, 80);
const normalizedTask = (task: Task): Task => {
  const rating = calculateRating(task).total;
  return { ...task, rating, readinessLevel: getReadinessLevel(rating), updatedAt: new Date().toISOString() };
};
const contentKeys: (keyof Task)[] = [...TASK_FIELDS.map(field => field.key), 'industry', 'tags', 'rawDraft'];

export const useAppStore = create<AppState>()(persist((set, get) => {
  const commit = (update: Partial<AppState>) => {
    set(update);
    const storageError = getStorageError();
    if (storageError !== get().storageError) set({ storageError });
  };
  const deny = (message: string) => { commit({ toast: message }); return false; };
  const business = () => get().activeRole === 'business';
  return {
    ...initialState(), toast: null, storageError: getStorageError(),
    navigate(page) {
      const allowed: AppPage[] = business() ? ['overview', 'builder', 'tasks', 'proposals', 'catalog', 'inspector'] : ['catalog', 'recommendations', 'my-proposals', 'team', 'inspector'];
      if (allowed.includes(page)) commit({ page });
    },
    setActiveRole(activeRole) {
      commit({ activeRole, page: activeRole === 'business' ? 'overview' : 'catalog', activeTaskId: null });
    },
    setActiveTeam(activeTeamId) {
      if (activeTeamId === null || get().teams.some(team => team.id === activeTeamId)) commit({ activeTeamId });
    },
    setActiveTask(activeTaskId) {
      if (activeTaskId === null || get().tasks.some(task => task.id === activeTaskId && (business() || task.published))) commit({ activeTaskId });
    },
    addTask(task) {
      if (!business()) { deny('Создавать задачи может только бизнес.'); return; }
      const state = get();
      if (state.tasks.some(item => item.id === task.id)) { deny('Такая задача уже существует.'); return; }
      const fresh = normalizedTask({ ...task, confirmed: false, published: false, confirmedFields: [] });
      commit({ tasks: [fresh, ...state.tasks], activeTaskId: task.id, events: withEvent(state, 'Задача создана', task.title || 'Новый черновик') });
    },
    updateTask(task) {
      if (!business()) { deny('Редактировать задачи может только бизнес.'); return; }
      const state = get();
      const previous = state.tasks.find(item => item.id === task.id);
      if (!previous) return;
      const changed = contentKeys.some(key => JSON.stringify(previous[key]) !== JSON.stringify(task[key]));
      const next = normalizedTask({ ...task, createdAt: previous.createdAt,
        confirmed: changed ? false : previous.confirmed,
        published: changed ? false : previous.published,
        confirmedFields: changed ? [] : previous.confirmedFields,
      });
      const improved = next.rating > previous.rating;
      commit({ tasks: state.tasks.map(item => item.id === task.id ? next : item),
        events: improved ? withEvent(state, 'Рейтинг задачи вырос', `${previous.rating} → ${next.rating} · ${next.title || 'Черновик'}`) : state.events,
        ...(changed && previous.confirmed ? { toast: 'Карточка изменена. Подтвердите данные повторно перед публикацией.' } : {}),
      });
    },
    confirmTask(id) {
      if (!business()) return deny('Подтверждать данные может только бизнес.');
      const state = get();
      const task = state.tasks.find(item => item.id === id);
      if (!task) return false;
      if (!task.title.trim() || !task.context.trim() || !task.need.trim()) return deny('Заполните название, контекст и потребность перед подтверждением.');
      if (task.confirmed) return true;
      const next = normalizedTask({ ...task, confirmed: true, confirmedFields: TASK_FIELDS.filter(field => task[field.key].trim()).map(field => field.key) });
      commit({ tasks: state.tasks.map(item => item.id === id ? next : item), toast: 'Карточка подтверждена бизнесом.', events: withEvent(state, 'Карточка подтверждена', task.title) });
      return true;
    },
    publishTask(id) {
      if (!business()) return deny('Публиковать задачи может только бизнес.');
      const state = get();
      const task = state.tasks.find(item => item.id === id);
      if (!task) return false;
      if (!task.confirmed) return deny('Сначала подтвердите корректность карточки.');
      if (task.published) return true;
      commit({ tasks: state.tasks.map(item => item.id === id ? { ...item, published: true, updatedAt: new Date().toISOString() } : item),
        toast: 'Задача опубликована и доступна всем командам.', events: withEvent(state, 'Задача опубликована', task.title) });
      return true;
    },
    addProposal(proposal) {
      const state = get();
      if (state.activeRole !== 'student') return deny('Переключитесь в роль студента, чтобы отправить отклик.');
      if (!state.activeTeamId || proposal.teamId !== state.activeTeamId || !state.teams.some(team => team.id === proposal.teamId)) return deny('Выберите активную команду.');
      const task = state.tasks.find(item => item.id === proposal.taskId);
      if (!task?.published) return deny('Отклик доступен только для опубликованной задачи.');
      if (state.proposals.some(item => item.id === proposal.id || (item.taskId === proposal.taskId && item.teamId === proposal.teamId))) return deny('Команда уже отправила предложение на эту задачу.');
      if (![proposal.idea, proposal.implementationPlan, proposal.estimatedTime].every(value => value.trim())) return deny('Заполните идею, план и оценку сроков.');
      if (!isSafePrototypeUrl(proposal.prototypeUrl)) return deny('Укажите корректную ссылку с https:// или http:// либо оставьте поле пустым.');
      const fresh: Proposal = { ...proposal, idea: proposal.idea.trim(), implementationPlan: proposal.implementationPlan.trim(), estimatedTime: proposal.estimatedTime.trim(), prototypeUrl: proposal.prototypeUrl.trim(), status: 'pending', createdAt: new Date().toISOString() };
      const team = state.teams.find(item => item.id === proposal.teamId);
      commit({ proposals: [fresh, ...state.proposals], toast: 'Предложение отправлено бизнесу.', events: withEvent(state, `${team?.name} отправила предложение`, task.title) });
      return true;
    },
    selectProposal(id) {
      if (!business()) return deny('Выбор команды подтверждает бизнес.');
      const state = get();
      const proposal = state.proposals.find(item => item.id === id);
      if (!proposal || proposal.status === 'rejected') return false;
      if (proposal.status === 'selected') return true;
      const existing = state.milestones.filter(item => item.taskId === proposal.taskId && item.teamId === proposal.teamId);
      const milestones = MILESTONE_TEMPLATES.filter(template => !existing.some(item => item.title === template.title)).map(template => ({
        ...template, id: crypto.randomUUID(), taskId: proposal.taskId, teamId: proposal.teamId, status: 'pending' as const,
      }));
      const team = state.teams.find(item => item.id === proposal.teamId);
      commit({ proposals: state.proposals.map(item => item.id === id ? { ...item, status: 'selected' } : item),
        milestones: [...state.milestones, ...milestones], toast: `Команда ${team?.name} выбрана. Остальные отклики доступны.`,
        events: withEvent(state, 'Бизнес выбрал команду', `${team?.name} · ${state.tasks.find(task => task.id === proposal.taskId)?.title}`) });
      return true;
    },
    rejectProposal(id) {
      if (!business()) return deny('Отклонять предложения может только бизнес.');
      const state = get();
      const proposal = state.proposals.find(item => item.id === id);
      if (!proposal) return false;
      if (proposal.status === 'rejected') return true;
      if (proposal.status === 'selected' || state.milestones.some(item => item.taskId === proposal.taskId && item.teamId === proposal.teamId)) return deny('По выбранной команде уже создан проект. Отклонение недоступно.');
      commit({ proposals: state.proposals.map(item => item.id === id ? { ...item, status: 'rejected' } : item),
        toast: 'Предложение отклонено.', events: withEvent(state, 'Предложение отклонено', state.teams.find(team => team.id === proposal.teamId)?.name) });
      return true;
    },
    confirmMilestone(id) {
      if (!business()) return deny('Выполнение этапа подтверждает бизнес.');
      const state = get();
      const milestone = state.milestones.find(item => item.id === id);
      if (!milestone || !state.proposals.some(item => item.taskId === milestone.taskId && item.teamId === milestone.teamId && item.status === 'selected')) return false;
      if (milestone.status === 'completed') return true;
      commit({ milestones: state.milestones.map(item => item.id === id ? { ...item, status: 'completed', confirmedAt: new Date().toISOString() } : item),
        teams: state.teams.map(team => team.id === milestone.teamId ? { ...team, progressPoints: team.progressPoints + milestone.points } : team),
        toast: `Этап ${milestone.title} подтверждён. +${milestone.points} баллов команде.`,
        events: withEvent(state, `Этап ${milestone.title} подтверждён`, `${state.teams.find(team => team.id === milestone.teamId)?.name} · +${milestone.points} баллов`) });
      return true;
    },
    resetDemo() {
      clearStorageError();
      commit({ ...initialState(), toast: 'Демонстрационные данные восстановлены.', storageError: null });
    },
    setDemoEnabled(demoEnabled) { commit({ demoEnabled }); },
    setDemoStep(demoStep) { if (Number.isFinite(demoStep)) commit({ demoStep: Math.max(0, Math.min(8, Math.trunc(demoStep))) }); },
    notify(toast) { commit({ toast }); },
    recordEvent(title, detail) { const state = get(); commit({ events: withEvent(state, title, detail) }); },
  };
}, {
  name: STORAGE_KEY, version: STORAGE_VERSION,
  storage: createJSONStorage(() => safeLocalStorage),
  partialize: state => ({
    tasks: state.tasks, teams: state.teams, proposals: state.proposals, milestones: state.milestones,
    activeRole: state.activeRole, activeTeamId: state.activeTeamId, activeTaskId: state.activeTaskId,
    page: state.page, demoEnabled: state.demoEnabled, demoStep: state.demoStep, events: state.events,
  }),
  merge: (persisted, current) => ({ ...current, ...(persisted as Partial<PersistedAppState> | undefined), storageError: getStorageError() }),
}));
