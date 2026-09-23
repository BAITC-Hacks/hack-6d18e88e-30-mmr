import { useState } from 'react';
import { useAppStore } from '../../app/store';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TeamSelector } from '../student/TeamSelector';
import { TaskDetails } from '../catalog/TaskDetails';
import { MilestoneTracker } from '../milestones/MilestoneTracker';
import { proposalLabels } from './proposalLabels';
import '../catalog/workspace.css';

export function MyProposals() {
  const { proposals, activeTeamId, tasks, navigate } = useAppStore();
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const own = proposals.filter((proposal) => proposal.teamId === activeTeamId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const selectedTask = tasks.find((task) => task.id === detailsId);
  return <div className="stack workspace-page"><header className="page-heading"><div><span className="eyebrow">ВАШИ ВОЗМОЖНОСТИ</span><h1>Мои отклики</h1><p className="muted">От первого предложения до результата — всё в одном месте.</p></div></header><TeamSelector />
    {own.length === 0 ? <EmptyState title="Начните с одной задачи" description="Найдите интересную бизнес-задачу и отправьте предложение от имени команды." action={<Button onClick={() => navigate('catalog')}>Перейти в каталог <span aria-hidden="true">↗</span></Button>} /> : <div className="stack">{own.map((proposal) => { const task = tasks.find((item) => item.id === proposal.taskId); return <article className="panel proposal-card" key={proposal.id}><div className="section-heading"><div><span className={`badge proposal-status status-${proposal.status}`}>{proposalLabels[proposal.status]}</span><h2>{task?.title ?? 'Бизнес-задача'}</h2><span className="muted small-text">Отправлено {new Date(proposal.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div><Button variant="secondary" onClick={() => setDetailsId(proposal.taskId)}>Открыть задачу</Button></div><p className="preserve-lines">{proposal.idea}</p><details className="proposal-plan"><summary>План реализации и сроки</summary><p className="preserve-lines">{proposal.implementationPlan}</p><p><strong>Срок:</strong> {proposal.estimatedTime}</p>{/^https?:\/\//i.test(proposal.prototypeUrl) && <a href={proposal.prototypeUrl} target="_blank" rel="noopener noreferrer">Открыть прототип ↗</a>}</details>{proposal.status === 'selected' && <MilestoneTracker taskId={proposal.taskId} teamId={proposal.teamId} readOnly />}</article>; })}</div>}
    {selectedTask && <TaskDetails task={selectedTask} onClose={() => setDetailsId(null)} />}
  </div>;
}
