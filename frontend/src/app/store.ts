import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task } from '../types/task';
import type { Team } from '../types/team';
import type { Proposal, ProposalStatus } from '../types/proposal';
import type { Milestone } from '../types/milestone';
import { seedTasks, seedTeams, seedProposals } from '../data/syntheticData';
import { calculateRating, getReadinessLevel } from '../services/ratingService';

interface AppState {
  tasks: Task[];
  teams: Team[];
  proposals: Proposal[];
  milestones: Milestone[];
  activeRole: 'business' | 'student';
  activeTeamId: string | null;
  activeTaskId: string | null;

  // Role & selection
  setActiveRole: (role: 'business' | 'student') => void;
  setActiveTeam: (teamId: string | null) => void;
  setActiveTask: (taskId: string | null) => void;

  // Task operations
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  confirmTask: (taskId: string) => void;
  publishTask: (taskId: string) => void;

  // Proposal operations
  addProposal: (proposal: Proposal) => void;
  setProposalDecision: (proposalId: string, status: ProposalStatus) => void;

  // Milestones & progress points
  addMilestone: (milestone: Milestone) => void;
  confirmMilestone: (milestoneId: string) => void;

  // Reset to initial hackathon seeds
  resetToSeedData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      tasks: seedTasks,
      teams: seedTeams,
      proposals: seedProposals,
      milestones: [],
      activeRole: 'business',
      activeTeamId: 'team-1',
      activeTaskId: 'task-1',

      setActiveRole: (activeRole) => set({ activeRole }),
      setActiveTeam: (activeTeamId) => set({ activeTeamId }),
      setActiveTask: (activeTaskId) => set({ activeTaskId }),

      addTask: (task) => {
        const ratingResult = calculateRating(task);
        const taskWithRating: Task = {
          ...task,
          rating: ratingResult.total,
          readinessLevel: getReadinessLevel(ratingResult.total),
        };
        set((state) => ({
          tasks: [taskWithRating, ...state.tasks],
          activeTaskId: taskWithRating.id,
        }));
      },

      updateTask: (task) => {
        const ratingResult = calculateRating(task);
        const taskWithRating: Task = {
          ...task,
          rating: ratingResult.total,
          readinessLevel: getReadinessLevel(ratingResult.total),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          tasks: state.tasks.map((item) => (item.id === task.id ? taskWithRating : item)),
        }));
      },

      confirmTask: (taskId) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, confirmed: true, updatedAt: new Date().toISOString() } : t
          ),
        }));
      },

      publishTask: (taskId) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, confirmed: true, published: true, updatedAt: new Date().toISOString() } : t
          ),
        }));
      },

      addProposal: (proposal) => {
        set((state) => ({
          proposals: [proposal, ...state.proposals],
        }));
      },

      setProposalDecision: (proposalId, status) => {
        set((state) => {
          const proposal = state.proposals.find((p) => p.id === proposalId);
          if (!proposal) return state;

          const updatedProposals = state.proposals.map((p) =>
            p.id === proposalId ? { ...p, status } : p
          );

          // If selected, automatically create a starter milestone for progress tracking
          let updatedMilestones = state.milestones;
          if (status === 'selected') {
            const milestoneExists = state.milestones.some(
              (m) => m.taskId === proposal.taskId && m.teamId === proposal.teamId
            );
            if (!milestoneExists) {
              const newMilestone: Milestone = {
                id: `ms-${Date.now()}`,
                taskId: proposal.taskId,
                teamId: proposal.teamId,
                title: 'Этап 1: Архитектура решения и MVP прототип',
                description: 'Согласование спецификации и первая демонстрация прототипа заказчику',
                status: 'pending',
                points: 50,
              };
              updatedMilestones = [...state.milestones, newMilestone];
            }
          }

          return {
            proposals: updatedProposals,
            milestones: updatedMilestones,
          };
        });
      },

      addMilestone: (milestone) => {
        set((state) => ({
          milestones: [...state.milestones, milestone],
        }));
      },

      confirmMilestone: (milestoneId) => {
        set((state) => {
          const milestone = state.milestones.find((m) => m.id === milestoneId);
          if (!milestone || milestone.status === 'completed') return state;

          const updatedMilestones = state.milestones.map((m) =>
            m.id === milestoneId
              ? { ...m, status: 'completed' as const, confirmedAt: new Date().toISOString() }
              : m
          );

          const updatedTeams = state.teams.map((t) =>
            t.id === milestone.teamId
              ? { ...t, progressPoints: t.progressPoints + milestone.points }
              : t
          );

          return {
            milestones: updatedMilestones,
            teams: updatedTeams,
          };
        });
      },

      resetToSeedData: () => {
        set({
          tasks: seedTasks,
          teams: seedTeams,
          proposals: seedProposals,
          milestones: [],
          activeRole: 'business',
          activeTeamId: 'team-1',
          activeTaskId: 'task-1',
        });
      },
    }),
    {
      name: 'ai-sana-taskrank-v1',
    }
  )
);
