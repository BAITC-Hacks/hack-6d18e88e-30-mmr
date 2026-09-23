import type { ProposalStatus } from '../../types/proposal';

export const proposalLabels: Record<ProposalStatus, string> = {
  pending: 'На рассмотрении',
  selected: 'Выбрано бизнесом',
  rejected: 'Отклонено',
};
