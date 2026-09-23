import { create } from 'zustand';
import type { Task } from '../types/task';
import type { Team } from '../types/team';
import type { Proposal } from '../types/proposal';
import type { Milestone } from '../types/milestone';

interface AppState {
  tasks: Task[];
  teams: Team[];
  proposals: Proposal[];
  milestones: Milestone[];
  activeRole: 'business' | 'student';
  activeTeamId: string | null;
  activeTaskId: string | null;
  setActiveRole: (role: 'business' | 'student') => void;
  setActiveTeam: (teamId: string | null) => void;
  setActiveTask: (taskId: string | null) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  addProposal: (proposal: Proposal) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tasks: [],
  teams: [],
  proposals: [],
  milestones: [],
  activeRole: 'business',
  activeTeamId: null,
  activeTaskId: null,
  setActiveRole: (activeRole) => set({ activeRole }),
  setActiveTeam: (activeTeamId) => set({ activeTeamId }),
  setActiveTask: (activeTaskId) => set({ activeTaskId }),
  addTask: (task) =>
    set((state) => ({
      tasks: [...state.tasks, task],
    })),
  updateTask: (task) =>
    set((state) => ({
      tasks: state.tasks.map((item) => (item.id === task.id ? task : item)),
    })),
  addProposal: (proposal) =>
    set((state) => ({
      proposals: [...state.proposals, proposal],
    })),
}));
