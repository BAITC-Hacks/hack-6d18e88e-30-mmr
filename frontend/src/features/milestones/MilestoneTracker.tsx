import { useAppStore } from '../../app/store';
import { Button } from '../../components/Button';
import { ProgressBar } from '../../components/ProgressBar';
import { EmptyState } from '../../components/EmptyState';

export function MilestoneTracker({ taskId, teamId, readOnly = false }: { taskId?: string; teamId?: string; readOnly?: boolean }) {
  const { milestones, confirmMilestone, activeRole, tasks, teams, navigate, setDemoStep } = useAppStore();
  const stages = milestones.filter((item) => (!taskId || item.taskId === taskId) && (!teamId || item.teamId === teamId));
  const completed = stages.filter((item) => item.status === 'completed');
  const earned = completed.reduce((sum, item) => sum + item.points, 0);
  if (!stages.length) return <EmptyState title="Сначала выберите команду" description={taskId ? `Для задачи «${tasks.find((task) => task.id === taskId)?.title ?? 'Бизнес-задача'}» ещё нет выбранной команды. После вашего решения появятся четыре этапа проекта.` : 'После выбора команды бизнесом здесь появятся Kickoff, Prototype, Validation и Final result.'} action={activeRole === 'business' && !readOnly ? <Button variant="secondary" onClick={() => { setDemoStep(7); navigate('proposals'); }}>Перейти к предложениям</Button> : undefined} />;
  if (!teamId) {
    const projects = [...new Map(stages.map((item) => [`${item.taskId}:${item.teamId}`, { taskId: item.taskId, teamId: item.teamId }])).values()];
    return <div className="stack">{projects.map((project) => <section className="panel" key={`${project.taskId}:${project.teamId}`}><span className="eyebrow">{teams.find((team) => team.id === project.teamId)?.name ?? 'Выбранная команда'}</span><h2>{tasks.find((task) => task.id === project.taskId)?.title ?? 'Бизнес-задача'}</h2><MilestoneTracker taskId={project.taskId} teamId={project.teamId} readOnly={readOnly} /></section>)}</div>;
  }
  return <section className="milestone-tracker" aria-label="Прогресс проекта"><div className="section-heading"><div><h3>Прогресс проекта</h3><p className="muted small-text">{completed.length} из {stages.length} этапов · {earned} баллов начислено</p></div><span className="milestone-fraction">{Math.round(completed.length / stages.length * 100)}%</span></div><ProgressBar value={completed.length} max={stages.length} /><ol className="milestone-list">{stages.map((milestone, index) => <li className={milestone.status === 'completed' ? 'is-complete' : ''} key={milestone.id}><span className="milestone-marker" aria-label={milestone.status === 'completed' ? 'Подтверждено' : 'Ожидает подтверждения'}>{milestone.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span><div className="milestone-copy"><h4>{milestone.title}</h4><p className="muted">{milestone.description}</p>{milestone.status === 'completed' && <span className="milestone-confirmed">+{milestone.points} баллов начислено{milestone.confirmedAt ? ` · ${new Date(milestone.confirmedAt).toLocaleDateString('ru-RU')}` : ''}</span>}</div>{milestone.status === 'pending' && <div className="milestone-action"><span className="muted">+{milestone.points} баллов</span>{!readOnly && activeRole === 'business' ? <Button variant="secondary" onClick={() => confirmMilestone(milestone.id)}>Подтвердить этап</Button> : <span className="small-text muted">Ожидает бизнес</span>}</div>}</li>)}</ol></section>;
}
