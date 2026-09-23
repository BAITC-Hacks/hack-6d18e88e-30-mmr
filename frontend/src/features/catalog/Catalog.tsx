import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../app/store';
import { Button } from '../../components/Button';
import { ReadinessBadge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { calculateTeamMatch } from '../../services/teamMatchService';
import { TeamSelector } from '../student/TeamSelector';
import { ProposalModal } from '../proposals/ProposalModal';
import { TaskDetails } from './TaskDetails';
import type { Task } from '../../types/task';
import './workspace.css';

export function Catalog({ recommendations = false }: { recommendations?: boolean }) {
  const { tasks, teams, proposals, activeRole, activeTeamId, activeTaskId, setActiveTask, demoStep } = useAppStore();
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('');
  const [readiness, setReadiness] = useState('');
  const [sort, setSort] = useState('rating');
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(() => demoStep === 6
    ? (tasks.find((task) => task.published && task.id === activeTaskId) ?? tasks.find((task) => task.published))?.id ?? null
    : null);
  const team = teams.find((item) => item.id === activeTeamId);
  const published = useMemo(() => tasks.filter((task) => task.published), [tasks]);
  const industries = [...new Set(published.map((task) => task.industry))].sort();
  const shownTasks = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const result = published.filter((task) =>
      (!search || [task.title, task.context, task.need, ...task.tags].join(' ').toLocaleLowerCase().includes(search)) &&
      (!industry || task.industry === industry) && (!readiness || task.readinessLevel === readiness));
    return result.sort((a, b) => {
      if (recommendations && team) return calculateTeamMatch(b, team).total - calculateTeamMatch(a, team).total || b.rating - a.rating;
      return sort === 'date' ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : b.rating - a.rating;
    });
  }, [published, query, industry, readiness, sort, recommendations, team]);

  useEffect(() => useAppStore.subscribe((state, previous) => {
    if (state.demoStep !== 6 || previous.demoStep === 6) return;
    const target = state.tasks.find((task) => task.published && task.id === state.activeTaskId)
      ?? state.tasks.find((task) => task.published);
    if (target) setProposalId(target.id);
  }), []);

  const details = tasks.find((task) => task.id === detailsId);
  const proposalTask = tasks.find((task) => task.id === proposalId);
  function openTask(task: Task) { setActiveTask(task.id); setDetailsId(task.id); }

  return <div className="stack workspace-page">
    <header className="page-heading catalog-heading">
      <div><span className="eyebrow">{recommendations ? 'TEAM MATCH' : 'ОТКРЫТЫЕ ВОЗМОЖНОСТИ'}</span>
        <h1>{recommendations ? `Задачи для ${team?.name ?? 'вашей команды'}` : 'Большие идеи. Реальные задачи.'}</h1>
        <p className="muted">{recommendations ? 'Подборка по навыкам и интересам команды. Решение, за что браться, — за вами.' : 'Найдите бизнес-задачу, к которой хочется приложить свои знания.'}</p>
      </div>
      <div className="catalog-total"><strong>{published.length.toString().padStart(2, '0')}</strong><span>открытых задач</span></div>
    </header>
    {activeRole === 'student' && <TeamSelector />}
    {recommendations && !team ? <EmptyState title="Сначала выберите команду" description="Подборка учитывает технологии, навыки, интересы и опыт вашей команды." /> : <>
      <div className="catalog-toolbar" role="search" aria-label="Фильтры задач">
        <label className="field search-field"><span>Поиск задачи</span><div className="search-input-wrap"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, задача или технология" /></div></label>
        <label className="field"><span>Отрасль</span><select value={industry} onChange={(event) => setIndustry(event.target.value)}><option value="">Все отрасли</option>{industries.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Готовность</span><select value={readiness} onChange={(event) => setReadiness(event.target.value)}><option value="">Все уровни</option><option value="priority">Приоритетная · 90–100</option><option value="ready">Готовая · 70–89</option><option value="working">Рабочая · 40–69</option><option value="draft">Черновик · 0–39</option></select></label>
        {!recommendations && <label className="field"><span>Порядок</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="rating">Сначала по готовности</option><option value="date">Сначала новые</option></select></label>}
      </div>
      <div className="catalog-results-heading"><span>{shownTasks.length} задач по вашему запросу</span><span className="muted">{recommendations ? 'По соответствию команде' : 'Откликнуться можно при любом рейтинге'}</span></div>
      {shownTasks.length === 0 ? <EmptyState title="Пока ничего не нашлось" description="Попробуйте другое название или расширьте фильтры." action={<Button variant="secondary" onClick={() => { setQuery(''); setIndustry(''); setReadiness(''); }}>Сбросить фильтры</Button>} /> : <div className="task-grid">{shownTasks.map((task, index) => {
        const count = proposals.filter((proposal) => proposal.taskId === task.id).length;
        const match = recommendations && team ? calculateTeamMatch(task, team) : null;
        return <article className="task-card" key={task.id}>
          <div className="task-card-top"><ReadinessBadge score={task.rating} /><div className="task-score"><strong>{task.rating}</strong><span>/ 100</span></div></div>
          <div className="task-industry"><span>{task.industry}</span><span className="task-index">{String(index + 1).padStart(2, '0')}</span></div>
          <h2><button className="text-button task-title-button" onClick={() => openTask(task)}>{task.title}</button></h2>
          <p className="task-description">{task.need || task.context || 'Детали задачи уточняются бизнесом.'}</p>
          <div className="tags">{task.tags.slice(0, 4).map((tag) => <span className="badge tag" key={tag}>{tag}</span>)}{task.tags.length > 4 && <span className="badge tag">+{task.tags.length - 4}</span>}</div>
          {match && <div className="match-summary"><strong>{match.total}%</strong><span>соответствие вашей команде</span></div>}
          <footer className="task-card-footer"><span>{count} откликов</span><Button variant="ghost" onClick={() => openTask(task)}>Подробнее <span aria-hidden="true">↗</span></Button></footer>
        </article>;
      })}</div>}
    </>}
    {details && <TaskDetails task={details} onClose={() => setDetailsId(null)} />}
    {proposalTask && <ProposalModal task={proposalTask} onClose={() => setProposalId(null)} />}
  </div>;
}
