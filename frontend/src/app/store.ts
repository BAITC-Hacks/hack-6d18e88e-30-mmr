import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task } from '../types/task';
import type { Proposal, ProposalStatus } from '../types/proposal';
import type { Milestone } from '../types/milestone';
import { seedTasks, seedTeams, seedProposals } from '../data/syntheticData';
import {
  confirmableFields, ensureStarterMilestones, milestoneSchema, proposalSchema,
  proposalStatusSchema, rateTask, restoreState, safeStorage, taskSchema,
  type StoredAppState,
} from './persistence';

interface AppState extends StoredAppState {
  setActiveRole: (role: 'business' | 'student') => void;
  setActiveTeam: (teamId: string | null) => void;
  setActiveTask: (taskId: string | null) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  confirmTask: (taskId: string) => void;
  publishTask: (taskId: string) => void;
  addProposal: (proposal: Proposal) => void;
  setProposalDecision: (proposalId: string, status: ProposalStatus) => void;
  addMilestone: (milestone: Milestone) => void;
  confirmMilestone: (milestoneId: string) => void;
  resetToSeedData: () => void;
}

function initialData(): StoredAppState {
  return {
    tasks: seedTasks.map(rateTask),
    teams: structuredClone(seedTeams),
    proposals: structuredClone(seedProposals),
    milestones: ensureStarterMilestones(seedProposals, []),
    activeRole: 'business', activeTeamId: seedTeams[0]?.id ?? null,
    activeTaskId: seedTasks[0]?.id ?? null,
  };
}

function isSelected(state: AppState, taskId: string, teamId: string): boolean {
  return state.tasks.some((task) => task.id === taskId)
    && state.teams.some((team) => team.id === teamId)
    && state.proposals.some((proposal) => proposal.taskId === taskId
      && proposal.teamId === teamId && proposal.status === 'selected');
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialData(),
      setActiveRole: (activeRole) => {
        if (activeRole === 'business' || activeRole === 'student') set({ activeRole });
      },
      setActiveTeam: (activeTeamId) => set((state) =>
        activeTeamId === null || state.teams.some((team) => team.id === activeTeamId) ? { activeTeamId } : state),
      setActiveTask: (activeTaskId) => set((state) =>
        activeTaskId === null || state.tasks.some((task) => task.id === activeTaskId) ? { activeTaskId } : state),

      addTask: (task) => {
        const parsed = taskSchema.safeParse(task);
        if (!parsed.success) return;
        // Generated content needs an explicit human confirmation before earning points.
        const draft = rateTask({ ...parsed.data, confirmedFields: [], confirmed: false, published: false });
        set((state) => state.tasks.some((item) => item.id === draft.id) ? state : {
          tasks: [draft, ...state.tasks], activeTaskId: draft.id,
        });
      },

      updateTask: (task) => {
        const parsed = taskSchema.safeParse(task);
        if (!parsed.success) return;
        set((state) => {
          const previous = state.tasks.find((item) => item.id === task.id);
          if (!previous) return state;
          const changed = confirmableFields.some((field) => previous[field] !== parsed.data[field])
            || previous.industry !== parsed.data.industry
            || JSON.stringify(previous.tags) !== JSON.stringify(parsed.data.tags);
          const updated = rateTask({
            ...parsed.data,
            // A copied confirmedFields array cannot confirm new or edited content.
            confirmedFields: previous.confirmedFields.filter((field) =>
              confirmableFields.some((key) => key === field && previous[key] === parsed.data[key])
                && parsed.data.confirmedFields.includes(field)),
            confirmed: changed ? false : previous.confirmed,
            published: changed ? false : previous.published,
            createdAt: previous.createdAt,
            updatedAt: new Date().toISOString(),
          });
          return { tasks: state.tasks.map((item) => item.id === updated.id ? updated : item) };
        });
      },

      confirmTask: (taskId) => set((state) => ({
        tasks: state.tasks.map((task) => task.id === taskId ? rateTask({
          ...task, confirmed: true,
          confirmedFields: confirmableFields.filter((field) => task[field].trim().length > 0),
          updatedAt: new Date().toISOString(),
        }) : task),
      })),

      publishTask: (taskId) => set((state) => ({
        tasks: state.tasks.map((task) => task.id === taskId && task.confirmed
          ? { ...task, published: true, updatedAt: new Date().toISOString() } : task),
      })),

      addProposal: (proposal) => {
        const parsed = proposalSchema.safeParse(proposal);
        if (!parsed.success) return;
        set((state) => {
          if (state.proposals.some((item) => item.id === parsed.data.id)
            || !state.tasks.some((task) => task.id === parsed.data.taskId && task.published)
            || !state.teams.some((team) => team.id === parsed.data.teamId)) return state;
          return { proposals: [{ ...parsed.data, status: 'pending' as const }, ...state.proposals] };
        });
      },

      setProposalDecision: (proposalId, status) => {
        if (!proposalStatusSchema.safeParse(status).success) return;
        set((state) => {
          if (!state.proposals.some((proposal) => proposal.id === proposalId)) return state;
          const proposals = state.proposals.map((proposal) => proposal.id === proposalId ? { ...proposal, status } : proposal);
          return { proposals, milestones: ensureStarterMilestones(proposals, state.milestones) };
        });
      },

      addMilestone: (milestone) => {
        const parsed = milestoneSchema.safeParse(milestone);
        if (!parsed.success) return;
        set((state) => {
          if (state.milestones.some((item) => item.id === parsed.data.id)
            || !isSelected(state, parsed.data.taskId, parsed.data.teamId)) return state;
          return { milestones: [...state.milestones, { ...parsed.data, status: 'pending' as const, confirmedAt: undefined }] };
        });
      },

      confirmMilestone: (milestoneId) => set((state) => {
        const milestone = state.milestones.find((item) => item.id === milestoneId);
        if (!milestone || milestone.status === 'completed'
          || !isSelected(state, milestone.taskId, milestone.teamId)) return state;
        const team = state.teams.find((item) => item.id === milestone.teamId)!;
        if (!Number.isSafeInteger(team.progressPoints + milestone.points)) return state;
        return {
          milestones: state.milestones.map((item) => item.id === milestoneId
            ? { ...item, status: 'completed' as const, confirmedAt: new Date().toISOString() } : item),
          teams: state.teams.map((item) => item.id === milestone.teamId
            ? { ...item, progressPoints: item.progressPoints + milestone.points } : item),
        };
      }),

      resetToSeedData: () => set(initialData()),
    }),
    {
      name: 'ai-sana-taskrank-v1',
      storage: safeStorage,
      partialize: ({ tasks, teams, proposals, milestones, activeRole, activeTeamId, activeTaskId }) =>
        ({ tasks, teams, proposals, milestones, activeRole, activeTeamId, activeTaskId }),
      merge: (persisted, current) => ({ ...current, ...restoreState(persisted, current) }),
    },
  ),
);
