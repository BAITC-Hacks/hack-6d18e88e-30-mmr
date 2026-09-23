import { useState } from 'react';
import { useAppStore } from '../../app/store';
import { Button } from '../../components/Button';
import { ReadinessBadge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ScoreRing } from '../../components/ScoreRing';
import { ProgressBar } from '../../components/ProgressBar';
import { calculateTeamMatch } from '../../services/teamMatchService';
import type { Task } from '../../types/task';
import { ProposalModal } from '../proposals/ProposalModal';
import { proposalLabels } from '../proposals/proposalLabels';

const detailFields: { key: keyof Task; label: string }[] = [
  { key: 'context', label: 'Контекст' }, { key: 'need', label: 'Потребность бизнеса' },
  { key: 'targetUsers', label: 'Целевые пользователи' }, { key: 'availableData', label: 'Доступные данные и материалы' },
  { key: 'constraints', label: 'Ограничения' }, { key: 'expectedResult', label: 'Ожидаемый результат' },
  { key: 'successCriteria', label: 'Критерии успеха' }, { key: 'contact', label: 'Контакт бизнеса' },
  { key: 'consultationFormat', label: 'Формат консультаций' },
];

export function TaskDetails({ task, onClose }: { task: Task; onClose: () => void }) {
  const { activeRole, teams, activeTeamId, proposals, navigate } = useAppStore();
  const [applying, setApplying] = useState(false);
  const team = teams.find((item) => item.id === activeTeamId);
  const match = team ? calculateTeamMatch(task, team) : null;
  const ownProposal = proposals.find((item) => item.taskId === task.id && item.teamId === activeTeamId);
  const count = proposals.filter((item) => item.taskId === task.id).length;

  if (applying) return <ProposalModal task={task} onClose={onClose} />;
  return <Modal open onClose={onClose} title={task.title} wide>
    <div className="task-details-summary"><div><span className="eyebrow">{task.industry}</span><div className="tags"><ReadinessBadge score={task.rating} />{task.confirmed && <span className="badge">Подтверждено бизнесом</span>}<span className="muted">{count} откликов</span></div></div><ScoreRing score={task.rating} size={88} /></div>
    <div className="tags detail-tags">{task.tags.map((tag) => <span className="badge tag" key={tag}>{tag}</span>)}</div>
    <div className="details-grid">{detailFields.map(({ key, label }) => <section className="detail-field" key={key}><h3>{label}</h3><p>{String(task[key] || 'Бизнес пока не уточнил это поле.')}</p></section>)}</div>
    {activeRole === 'student' && match && <section className="match-explanation"><div className="section-heading"><div><span className="eyebrow">ПОЧЕМУ ПОДХОДИТ</span><h3>{team?.name} · {match.total}% соответствия</h3></div></div><div className="match-factors">{([{ label: 'Технологии', value: match.technologies }, { label: 'Навыки', value: match.skills }, { label: 'Интересы', value: match.interests }, { label: 'Отрасль', value: match.industry }]).map((item) => <div key={item.label}><div className="match-factor-label"><span>{item.label}</span><strong>{item.value}%</strong></div><ProgressBar value={item.value} /></div>)}</div><div className="match-keywords"><div><h4>Совпадает</h4><div className="tags">{match.matching.length ? match.matching.map((item) => <span className="badge" key={item}>{item}</span>) : <span className="muted">Прямых совпадений пока нет</span>}</div></div><div><h4>Можно усилить</h4><div className="tags">{match.missing.length ? match.missing.map((item) => <span className="badge tag" key={item}>{item}</span>) : <span className="muted">Все указанные требования покрыты</span>}</div></div></div><p className="muted small-text">Соответствие рассчитано по профилю команды. Оно помогает сравнивать задачи и не ограничивает выбор.</p></section>}
    {activeRole === 'student' && ownProposal && <p className="notice">Статус ранее отправленного предложения: {proposalLabels[ownProposal.status]}. Вы можете предложить ещё одну идею.</p>}
    <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Закрыть</Button>{activeRole === 'student' && task.published && <>{ownProposal && <Button variant="secondary" onClick={() => { onClose(); navigate('my-proposals'); }}>Перейти к моему отклику</Button>}<Button onClick={() => setApplying(true)} disabled={!team}>{ownProposal ? 'Ещё предложение' : 'Отправить предложение'} <span aria-hidden="true">↗</span></Button></>}</div>
    {activeRole === 'student' && !team && <p className="muted small-text">Чтобы отправить предложение, выберите активную команду в каталоге.</p>}
  </Modal>;
}
