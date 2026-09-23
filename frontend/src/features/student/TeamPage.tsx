import { useAppStore } from '../../app/store';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TeamSelector } from './TeamSelector';
import { MilestoneTracker } from '../milestones/MilestoneTracker';
import '../catalog/workspace.css';

export function TeamPage() {
  const { teams, activeTeamId, proposals, tasks, navigate } = useAppStore();
  const team = teams.find((item) => item.id === activeTeamId);
  // Several accepted proposals can describe the same team/project. Its progress
  // and milestone ledger belong to the task/team pair, not to each proposal.
  const selected = [...new Map(proposals.filter((item) => item.teamId === activeTeamId && item.status === 'selected')
    .map(proposal => [proposal.taskId, proposal])).values()];
  return <div className="stack workspace-page"><header className="page-heading"><div><span className="eyebrow">ПРОФИЛЬ КОМАНДЫ</span><h1>Сильнее вместе.</h1><p className="muted">Ваши компетенции, интересы и прогресс в реальных проектах.</p></div></header><TeamSelector />
    {team ? <><section className="panel team-profile"><div className="section-heading"><div><span className="eyebrow">ВАША КОМАНДА</span><h2>{team.name}</h2><p className="muted">{team.description}</p></div><div className="team-profile-points"><strong>{team.progressPoints}</strong><span>баллов за подтверждённые этапы</span></div></div><div className="team-profile-grid">{[{ label: 'Технологии', values: team.technologies }, { label: 'Навыки', values: team.skills }, { label: 'Интересы', values: team.interests }, { label: 'Отрасли', values: team.industries }].map((group) => <section key={group.label}><h3>{group.label}</h3><div className="tags">{group.values.map((value) => <span className="badge tag" key={value}>{value}</span>)}</div></section>)}</div><Button onClick={() => navigate('recommendations')}>Найти подходящую задачу <span aria-hidden="true">↗</span></Button></section>
      <section className="stack"><div className="section-heading"><h2>Проекты команды</h2><span className="muted">{selected.length} активных</span></div>{selected.length ? selected.map((proposal) => <article className="panel" key={proposal.id}><span className="eyebrow">КОМАНДА ВЫБРАНА</span><h3>{tasks.find((task) => task.id === proposal.taskId)?.title ?? 'Бизнес-задача'}</h3><MilestoneTracker taskId={proposal.taskId} teamId={team.id} readOnly /></article>) : <EmptyState title="Первый проект впереди" description="Откликайтесь на задачи. После выбора команды бизнесом здесь появится прогресс проекта." action={<Button variant="secondary" onClick={() => navigate('catalog')}>Открыть каталог</Button>} />}</section>
    </> : <EmptyState title="Выберите команду" description="Профиль появится после выбора команды выше." />}
  </div>;
}
