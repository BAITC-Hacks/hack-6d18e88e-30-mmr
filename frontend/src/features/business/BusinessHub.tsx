import { useState } from 'react';
import { useAppStore } from '../../app/store';
import { Button } from '../../components/Button';
import { ReadinessBadge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { calculateTeamMatch } from '../../services/teamMatchService';
import { createEmptyTask } from '../../data/syntheticData';
import { TaskDetails } from '../catalog/TaskDetails';
import { MilestoneTracker } from '../milestones/MilestoneTracker';
import { ActivityTimeline } from '../demo/ActivityTimeline';
import { proposalLabels } from '../proposals/proposalLabels';
import type { Proposal } from '../../types/proposal';
import type { Task } from '../../types/task';
import '../catalog/workspace.css';

function PrototypeLink({ url }: { url: string }) {
  if (!/^https?:\/\//i.test(url)) return <span className="muted">Не приложен</span>;
  return <a href={url} target="_blank" rel="noopener noreferrer">Открыть прототип ↗</a>;
}

function ProposalComparison({ proposals, task, onClose }: { proposals: Proposal[]; task: Task; onClose: () => void }) {
  const { teams, selectProposal } = useAppStore();
  return <Modal open onClose={onClose} title="Сравнение предложений" wide><p className="muted">{task.title}. Вы можете выбрать несколько команд. Выбор одной не меняет статусы остальных.</p><div className="table-wrap comparison-wrap"><table className="comparison-table"><thead><tr><th scope="col">Показатель</th>{proposals.map((proposal) => <th scope="col" key={proposal.id}>{teams.find((team) => team.id === proposal.teamId)?.name ?? 'Команда'}</th>)}</tr></thead><tbody>
    <tr><th scope="row">Соответствие</th>{proposals.map((proposal) => { const team = teams.find((item) => item.id === proposal.teamId); return <td key={proposal.id}>{team ? `${calculateTeamMatch(task, team).total}%` : '—'}</td>; })}</tr>
    <tr><th scope="row">Совпадения стека</th>{proposals.map((proposal) => { const team = teams.find((item) => item.id === proposal.teamId); const technologies = new Set(team?.technologies.map((item) => item.toLocaleLowerCase())); return <td key={proposal.id}>{team ? calculateTeamMatch(task, team).matching.filter((item) => technologies.has(item.toLocaleLowerCase())).length : '—'}</td>; })}</tr>
    <tr><th scope="row">Совпадения в профиле</th>{proposals.map((proposal) => { const team = teams.find((item) => item.id === proposal.teamId); return <td key={proposal.id}>{team ? calculateTeamMatch(task, team).matching.join(', ') || 'Нет прямых совпадений' : '—'}</td>; })}</tr>
    <tr><th scope="row">Срок</th>{proposals.map((proposal) => <td key={proposal.id}>{proposal.estimatedTime}</td>)}</tr>
    <tr><th scope="row">Прототип</th>{proposals.map((proposal) => <td key={proposal.id}><PrototypeLink url={proposal.prototypeUrl} /></td>)}</tr>
    <tr><th scope="row">Идея</th>{proposals.map((proposal) => <td key={proposal.id}>{proposal.idea}</td>)}</tr>
    <tr><th scope="row">Решение бизнеса</th>{proposals.map((proposal) => <td key={proposal.id}>{proposal.status === 'pending' ? <Button onClick={() => selectProposal(proposal.id)}>Выбрать команду</Button> : <span className={`badge status-${proposal.status}`}>{proposalLabels[proposal.status]}</span>}</td>)}</tr>
  </tbody></table></div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Закрыть сравнение</Button></div></Modal>;
}

export function BusinessHub({ view }: { view: 'overview' | 'tasks' | 'proposals' }) {
  const { tasks, teams, proposals, milestones, activeTaskId, setActiveTask, addTask, navigate, selectProposal, rejectProposal, demoStep } = useAppStore();
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState('');
  const selectedTask = tasks.find((task) => task.id === activeTaskId) ?? tasks.find((task) => task.published) ?? tasks[0];
  const taskProposals = proposals.filter((proposal) => proposal.taskId === selectedTask?.id);
  const shownProposals = taskProposals.filter((proposal) => !status || proposal.status === status);
  const published = tasks.filter((task) => task.published);
  const pending = proposals.filter((proposal) => proposal.status === 'pending');
  const selected = proposals.filter((proposal) => proposal.status === 'selected');
  const completed = milestones.filter((milestone) => milestone.status === 'completed');
  const details = tasks.find((task) => task.id === detailsId);
  const sortedTasks = [...tasks].filter((task) => !taskFilter || (taskFilter === 'published' ? task.published : !task.published)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  function openProposals(task: Task) { setActiveTask(task.id); setStatus(''); navigate('proposals'); }
  function createTask() { const task = createEmptyTask(); addTask(task); setActiveTask(task.id); navigate('builder'); }
  function taskList(items: Task[]) { return <div className="business-task-list">{items.map((task) => {
    const responses = proposals.filter((proposal) => proposal.taskId === task.id);
    const chosen = responses.filter((proposal) => proposal.status === 'selected').length;
    return <article className="business-task-row" key={task.id}><div className="business-task-info"><div className="tags"><span className="eyebrow">{task.industry}</span><span className={`badge ${task.published ? '' : 'tag'}`}>{task.published ? 'Опубликована' : 'Не опубликована'}</span></div><h3><button className="text-button task-title-button" onClick={() => setDetailsId(task.id)}>{task.title}</button></h3><ReadinessBadge score={task.rating} /></div><div className="task-row-stat"><strong>{task.rating}</strong><span>готовность</span></div><div className="task-row-stat"><strong>{responses.length}</strong><span>откликов</span></div><div className="task-row-stat"><strong>{chosen}</strong><span>команд выбрано</span></div><Button variant="secondary" onClick={() => { if (task.published) openProposals(task); else { setActiveTask(task.id); navigate('builder'); } }}>{task.published ? 'Открыть отклики' : 'Продолжить карточку'}<span aria-hidden="true">↗</span></Button></article>;
  })}</div>; }

  return <div className="stack workspace-page">
    <header className="page-heading"><div><span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО БИЗНЕСА</span><h1>{view === 'overview' ? 'От задачи к результату.' : view === 'tasks' ? 'Мои задачи' : 'Предложения команд'}</h1><p className="muted">{view === 'overview' ? 'Сформулируйте потребность. Найдите команду. Двигайтесь по понятным этапам.' : view === 'tasks' ? 'Готовность карточек, отклики и команды — под вашим контролем.' : 'Изучите подходы и выберите команды, с которыми хотите работать.'}</p></div>{view !== 'proposals' && <Button onClick={createTask}>Создать задачу <span aria-hidden="true">+</span></Button>}</header>
    {view === 'overview' && <>
      <section className="business-intro"><div><span className="eyebrow">ХОРОШО СФОРМУЛИРОВАНО — НАПОЛОВИНУ РЕШЕНО</span><h2>Ваша экспертиза.<br />Их свежий взгляд.</h2><p>Превратите реальную потребность бизнеса в проект для студенческой команды. AI поможет задать правильные вопросы.</p><Button onClick={createTask}>Сформулировать задачу <span aria-hidden="true">↗</span></Button></div><div className="intro-track" aria-label="Три шага к проекту"><div><span>01</span><strong>Расскажите о задаче</strong><p>От свободного описания к ясной карточке</p></div><div><span>02</span><strong>Выберите команду</strong><p>Сравните идеи и подходы студентов</p></div><div><span>03</span><strong>Подтвердите результат</strong><p>Четыре этапа с измеримым прогрессом</p></div></div></section>
      <section className="business-metrics" aria-label="Статистика"><div className="business-metric"><span>Открытые задачи</span><strong>{String(published.length).padStart(2, '0')}</strong><span className="muted">{tasks.length - published.length} в работе</span></div><div className="business-metric"><span>Ожидают решения</span><strong>{String(pending.length).padStart(2, '0')}</strong><span className="muted">предложений от команд</span></div><div className="business-metric"><span>Выбранные команды</span><strong>{String(selected.length).padStart(2, '0')}</strong><span className="muted">работают над задачами</span></div><div className="business-metric"><span>Подтверждено этапов</span><strong>{String(completed.length).padStart(2, '0')}</strong><span className="muted">из {milestones.length} этапов проектов</span></div></section>
      <section className="panel business-tasks-panel"><div className="section-heading"><h2>Ваши задачи</h2><Button variant="ghost" onClick={() => navigate('tasks')}>Все задачи <span aria-hidden="true">↗</span></Button></div>{tasks.length ? taskList(sortedTasks.slice(0, 4)) : <EmptyState title="Начните с потребности бизнеса" description="Создайте первую карточку, чтобы студенческие команды смогли предложить решение." />}</section>
      <ActivityTimeline />
    </>}
    {view === 'tasks' && <section className="panel business-tasks-panel"><div className="section-heading"><h2>{sortedTasks.length} задач</h2><label className="field compact-field"><span className="sr-only">Статус задач</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="">Все статусы</option><option value="published">Опубликованные</option><option value="draft">В работе</option></select></label></div>{sortedTasks.length ? taskList(sortedTasks) : <EmptyState title="В этом разделе пока нет задач" description="Создайте новую карточку или выберите другой статус." />}</section>}
    {view === 'proposals' && <>
      <section className="panel proposals-toolbar"><label className="field"><span>Бизнес-задача</span><select value={selectedTask?.id ?? ''} onChange={(event) => { setActiveTask(event.target.value); setStatus(''); }}>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label><label className="field"><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Все предложения</option><option value="pending">На рассмотрении</option><option value="selected">Выбранные команды</option><option value="rejected">Отклонённые</option></select></label><Button variant="secondary" onClick={() => setCompare(true)} disabled={taskProposals.length < 2}>Сравнить предложения ({taskProposals.length})</Button></section>
      <div className="proposal-decision-note"><span className="decision-note-mark" aria-hidden="true">i</span><p>Команду выбираете вы. Можно выбрать несколько — остальные предложения останутся на рассмотрении.</p></div>
      {demoStep === 8 && <div className="notice">Откройте этапы выбранной команды ниже и подтвердите выполненный результат. Баллы начисляются один раз за этап.</div>}
      {shownProposals.length === 0 ? <EmptyState title={taskProposals.length ? 'Нет предложений с таким статусом' : 'Первый отклик впереди'} description={taskProposals.length ? 'Измените фильтр, чтобы увидеть остальные предложения.' : 'После публикации задачи студенческие команды смогут предложить свои идеи.'} action={taskProposals.length ? <Button variant="secondary" onClick={() => setStatus('')}>Показать все</Button> : undefined} /> : shownProposals.map((proposal) => { const team = teams.find((item) => item.id === proposal.teamId); const match = selectedTask && team ? calculateTeamMatch(selectedTask, team) : null; return <article className="panel business-proposal" key={proposal.id}><div className="section-heading"><div><div className="tags"><span className={`badge status-${proposal.status}`}>{proposalLabels[proposal.status]}</span><span className="muted small-text">{new Date(proposal.createdAt).toLocaleDateString('ru-RU')}</span></div><h2>{team?.name ?? 'Команда'}</h2><div className="tags">{team?.technologies.map((technology) => <span className="badge tag" key={technology}>{technology}</span>)}</div></div>{match && <div className="proposal-match"><strong>{match.total}<small>%</small></strong><span>соответствие</span></div>}</div><div className="proposal-content-grid"><section><h3>Идея и подход</h3><p className="preserve-lines">{proposal.idea}</p></section><section><h3>План реализации</h3><p className="preserve-lines">{proposal.implementationPlan}</p></section></div><div className="proposal-meta"><div><span className="muted">Оценка сроков</span><strong>{proposal.estimatedTime}</strong></div><div><span className="muted">Прототип / GitHub</span><PrototypeLink url={proposal.prototypeUrl} /></div></div>{proposal.status === 'pending' && <div className="proposal-decision-actions"><Button onClick={() => selectProposal(proposal.id)}>Выбрать команду <span aria-hidden="true">↗</span></Button><Button variant="ghost" onClick={() => setRejecting(proposal.id)}>Отклонить предложение</Button></div>}{proposal.status === 'selected' && <MilestoneTracker taskId={proposal.taskId} teamId={proposal.teamId} />}</article>; })}
    </>}
    {details && <TaskDetails task={details} onClose={() => setDetailsId(null)} />}
    {compare && selectedTask && <ProposalComparison proposals={taskProposals} task={selectedTask} onClose={() => setCompare(false)} />}
    {rejecting && <Modal open onClose={() => setRejecting(null)} title="Отклонить предложение?"><p>Студенческая команда увидит статус «Отклонено». Предложения других команд останутся без изменений.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRejecting(null)}>Отмена</Button><Button variant="danger" onClick={() => { rejectProposal(rejecting); setRejecting(null); }}>Отклонить предложение</Button></div></Modal>}
  </div>;
}
