export type ProposalStatus = | 'pending' | 'selected' | 'rejected';

export interface Proposal {
  id: string;
  taskId: string;
  teamId: string;
  idea: string;
  implementationPlan: string;
  estimatedTime: string;
  prototypeUrl: string;
  status: ProposalStatus;
  createdAt: string;
}
