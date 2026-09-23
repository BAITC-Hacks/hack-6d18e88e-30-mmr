import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useAppStore } from '../../app/store';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import type { Task } from '../../types/task';

export function ProposalModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { teams, activeTeamId, activeRole, addProposal, notify } = useAppStore();
  const [proposalTeamId] = useState(activeTeamId);
  const team = teams.find((item) => item.id === proposalTeamId);
  const teamChanged = proposalTeamId !== activeTeamId;
  const submitted = useRef(false);
  const [idea, setIdea] = useState('');
  const [plan, setPlan] = useState('');
  const [time, setTime] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitted.current) return;
    if (teamChanged) { setError('Активная команда изменилась. Закройте форму и откройте её для нужной команды.'); return; }
    if (activeRole !== 'student') { setError('Отправить предложение можно в роли студента.'); return; }
    if (!team) { setError('Выберите активную команду перед отправкой.'); return; }
    if (!idea.trim() || !plan.trim() || !time.trim()) { setError('Заполните идею, план реализации и оценку сроков.'); return; }
    if (url.trim()) {
      try { const parsed = new URL(url.trim()); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol'); }
      catch { setError('Ссылка на прототип должна начинаться с https:// или http:// и содержать адрес сайта.'); return; }
    }
    const added = addProposal({ id: crypto.randomUUID(), taskId: task.id, teamId: team.id, idea: idea.trim(), implementationPlan: plan.trim(), estimatedTime: time.trim(), prototypeUrl: url.trim(), status: 'pending', createdAt: new Date().toISOString() });
    if (!added) { setError(useAppStore.getState().toast ?? 'Не удалось отправить предложение. Проверьте команду и доступность задачи.'); return; }
    submitted.current = true;
    notify('Предложение отправлено. Бизнес увидит его в списке откликов.');
    onClose();
  }
  function fillExample() { setIdea(`Предлагаем проверить решение задачи «${task.title}» на небольшом пилоте. Начнём с анализа процесса и данных, затем соберём прототип для пользователей.`); setPlan('1. Kickoff: согласовать цель и доступ к данным.\n2. За 5 дней собрать работающий прототип.\n3. Проверить решение с пользователями и измерить результат.\n4. Передать исходный код, документацию и рекомендации.'); setTime('14 дней: 3 дня анализ, 7 дней разработка, 4 дня проверка'); setError(''); }
  return <Modal open onClose={onClose} title={`Предложение команды ${team?.name ?? '—'}`} wide>
    <p className="proposal-task-name">{task.title}</p>
    <form className="stack proposal-form" onSubmit={submit}>
      <p className="muted">Расскажите о подходе и ожидаемых сроках. Команду выбирает бизнес — независимо от рейтинга задачи.</p>
      <label className="field"><span>Идея и подход <span aria-hidden="true">*</span></span><textarea value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="Как вы предлагаете решить задачу?" rows={4} required maxLength={6000} /></label>
      <label className="field"><span>План реализации <span aria-hidden="true">*</span></span><textarea value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Основные шаги, инструменты и результат каждого этапа" rows={5} required maxLength={6000} /></label>
      <div className="form-grid"><label className="field"><span>Оценка сроков <span aria-hidden="true">*</span></span><input value={time} onChange={(event) => setTime(event.target.value)} placeholder="Например, 14 дней" required maxLength={250} /></label><label className="field"><span>Прототип / GitHub <span className="muted">необязательно</span></span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/..." maxLength={2000} /></label></div>
      {error && <p className="notice notice-warning" role="alert">{error}</p>}
      {!team && <p className="notice notice-warning" role="alert">Выберите активную команду в каталоге, затем откройте форму снова.</p>}
      {teamChanged && <p className="notice notice-warning" role="alert">Активная команда изменилась. Эта форма относится к {team?.name ?? 'предыдущей команде'}. Закройте её и откройте предложение для нужной команды.</p>}
      <div className="modal-actions proposal-actions"><Button type="button" variant="ghost" onClick={fillExample}>Заполнить пример</Button><div className="button-row"><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit" disabled={!team || teamChanged || activeRole !== 'student'}>Отправить предложение <span aria-hidden="true">↗</span></Button></div></div>
    </form>
  </Modal>;
}
