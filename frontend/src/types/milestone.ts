export type MilestoneStatus = | 'pending' | 'completed';

export interface Milestone {
  id: string;
  taskId: string;
  teamId: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  points: number;
  confirmedAt?: string;
}
