import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../app/store';
import { TASK_FIELDS } from '../../app/constants';
import type { TaskFieldKey } from '../../app/constants';
import { createEmptyTask, demoAnswers, seedTasks } from '../../data/syntheticData';
import { analyzeDraft, createClarificationQuestions } from '../../services/aiClient';
import { calculateRating } from '../../services/ratingService';
import type { Task } from '../../types/task';
import type { AiDraftAnalysis, FieldSource } from '../../types/ai';
import { Button } from '../../components/Button';
import { Badge, ReadinessBadge } from '../../components/Badge';
import { RatingPanel } from '../rating/RatingPanel';
import { sessions } from './builderSessions';
import './builder.css';

const steps = ['Черновик', 'Уточнение', 'Карточка', 'Рейтинг', 'Публикация'];
const sourceLabels: Record<FieldSource, string> = { draft: 'Из черновика', clarification: 'Ответ бизнеса', manual: 'Изменено вручную' };

export function TaskBuilder({ demoStep }: { demoStep?: number }) {
  const activeTaskId = useAppStore((state) => state.activeTaskId);
  const storeDemoStep = useAppStore((state) => state.demoStep);
  const selectedTask = useAppStore((state) => state.tasks.find((task) => task.id === activeTaskId));
  const [emptyTask] = useState(() => createEmptyTask());
  const task = selectedTask || emptyTask;
  return <BuilderFlow key={task.id} initialTask={task} demoStep={demoStep ?? storeDemoStep} />;
}

function BuilderFlow({ initialTask, demoStep }: { initialTask: Task; demoStep?: number }) {
  const task = useAppStore((state) => state.tasks.find((item) => item.id === initialTask.id)) || initialTask;
  const activeRole = useAppStore((state) => state.activeRole);
  const previousSession = sessions.get(task.id);
  const [stage, setStage] = useState(previousSession?.stage ?? (task.published ? 4 : task.need ? 2 : 0));
  const [analysis, setAnalysis] = useState<AiDraftAnalysis | null>(previousSession?.analysis ?? null);
  const [exampleAnswers, setExampleAnswers] = useState(previousSession?.exampleAnswers ?? false);
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [tagsText, setTagsText] = useState(task.tags.join(', '));
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const demoAnalyzed = useRef(false);
  const draft = task.rawDraft || '';
  const industries = [...new Set(['Retail', 'Education', 'Healthcare', 'Logistics', 'FinTech', task.industry, ...seedTasks.map(item => item.industry)])].filter(Boolean);
  const rating = calculateRating(task);
  const emptyFields = TASK_FIELDS.filter(({ key }) => !task[key].trim()).map(({ key }) => key);
  const questions = analysis?.questions || createClarificationQuestions(emptyFields);

  useEffect(() => {
    sessions.set(task.id, { stage, analysis, exampleAnswers });
  }, [task.id, stage, analysis, exampleAnswers]);

  useEffect(() => {
    if (document.activeElement?.id !== 'task-tags') setTagsText(task.tags.join(', '));
  }, [task.tags]);

  useEffect(() => () => { generation.current += 1; controller.current?.abort(); demoAnalyzed.current = false; }, []);

  function save(next: Task) {
    const store = useAppStore.getState();
    if (store.tasks.some((item) => item.id === next.id)) store.updateTask(next);
    else { store.addTask(next); store.setActiveTask(next.id); }
    setConsent(false);
  }

  function updateField(field: TaskFieldKey, value: string, source: FieldSource) {
    save({ ...task, [field]: value, fieldSources: { ...task.fieldSources, [field]: source } });
  }

  function updateDraft(rawDraft: string, industry = task.industry) {
    if (rawDraft === draft && industry === task.industry) return;
    generation.current += 1;
    controller.current?.abort();
    demoAnalyzed.current = false;
    setLoading(false); setAnalysis(null); setError('');
    const next = { ...task, rawDraft, industry, fieldSources: { ...task.fieldSources } };
    // Draft-derived facts lose their source when the draft changes. Business
    // answers, including deliberately empty fields, remain under business control.
    if (rawDraft !== draft) for (const { key } of TASK_FIELDS) {
      if (next.fieldSources[key] === 'draft') {
        next[key] = '';
        delete next.fieldSources[key];
      }
    }
    save(next);
  }

  async function runAnalysis() {
    if (loading || !draft.trim() || activeRole !== 'business') return;
    const requestId = ++generation.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setLoading(true); setError('');
    try {
      const result = await analyzeDraft(draft, task.industry, { signal: requestController.signal });
      if (requestId !== generation.current || requestController.signal.aborted) return;
      const current = useAppStore.getState().tasks.find((item) => item.id === task.id) || task;
      if ((current.rawDraft || '') !== draft || current.industry !== task.industry) return;
      const next = { ...current, fieldSources: { ...current.fieldSources } };
      for (const { key } of TASK_FIELDS) {
        const extracted = result.detectedFields[key];
        const source = next.fieldSources[key];
        if (source === 'manual' || source === 'clarification') continue;
        if (source === 'draft' || !next[key].trim()) {
          if (extracted?.value.trim()) {
            next[key] = extracted.value;
            next.fieldSources[key] = 'draft';
          } else if (source === 'draft') {
            next[key] = '';
            delete next.fieldSources[key];
          }
        }
      }
      save(next);
      setAnalysis(result); setStage(1);
      useAppStore.getState().recordEvent('Черновик проанализирован', result.fallbackUsed ? 'Локальные вопросы: AI недоступен' : result.provider);
    } catch (failure) {
      if (requestId === generation.current && !requestController.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не удалось проанализировать черновик. Повторите попытку.');
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (demoStep === 1) {
      generation.current += 1;
      controller.current?.abort();
      demoAnalyzed.current = false;
      setLoading(false);
      setStage(0);
    }
    if (demoStep === 2) {
      if (analysis) setStage(1);
      else if (draft.trim() && !demoAnalyzed.current) { demoAnalyzed.current = true; void runAnalysis(); }
    }
    if (demoStep === 3) setStage(1);
    // Only a deliberate demo-step change initiates analysis; edits never trigger a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoStep]);

  function fillExamples() {
    const next = { ...task, fieldSources: { ...task.fieldSources } };
    for (const { key } of TASK_FIELDS) {
      if (!next[key].trim() && demoAnswers[key]) { next[key] = demoAnswers[key]; next.fieldSources[key] = 'clarification'; }
    }
    if (!next.tags.length) next.tags = ['Python', 'Analytics'];
    save(next); setExampleAnswers(true);
    const after = calculateRating(next).potentialTotal;
    useAppStore.getState().recordEvent('Добавлены демонстрационные ответы', `Потенциал после подтверждения: ${rating.potentialTotal} → ${after}`);
    useAppStore.getState().notify('Примерные ответы заполнены. Проверьте и адаптируйте их под свою задачу.');
  }

  function openEditor(field?: string) {
    setStage(2);
    if (field) requestAnimationFrame(() => {
      const element = document.getElementById(`task-field-${field}`);
      element?.focus(); element?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }

  function confirm() {
    if (!consent || activeRole !== 'business') return;
    const missingRequired = TASK_FIELDS.filter(({ key }) => ['title', 'context', 'need'].includes(key) && !task[key].trim());
    if (missingRequired.length) { setError(`Перед подтверждением заполните: ${missingRequired.map(({ label }) => label.toLocaleLowerCase('ru')).join(', ')}.`); openEditor(missingRequired[0].key); return; }
    if (useAppStore.getState().confirmTask(task.id)) setError('');
  }

  return <div className="stack task-builder">
    <div className="page-heading"><div><span className="eyebrow">ОТ ИДЕИ К ПРОЕКТУ</span><h1>Конструктор задачи</h1><p className="muted">Сформулируйте задачу, которую команда сможет взять в работу.</p></div><Badge>{task.published ? 'Опубликована' : 'Черновик сохраняется автоматически'}</Badge></div>
    <ol className="builder-stepper" aria-label="Этапы создания задачи">
      {steps.map((label, index) => <li key={label} className={stage === index ? 'is-active' : stage > index ? 'is-complete' : ''}>
        <button type="button" disabled={loading || (index > 0 && !draft.trim() && !task.context.trim())} onClick={() => setStage(index)} aria-current={stage === index ? 'step' : undefined}><span>{stage > index ? '✓' : index + 1}</span>{label}</button>
      </li>)}
    </ol>
    {error && <div className="notice notice-warning" role="alert">{error}</div>}
    <div className="builder-layout">
      <div className="stack">
        {stage === 0 && <section className="panel stack" aria-busy={loading}>
          <div><span className="eyebrow">ШАГ 01</span><h2>Начните с бизнес-проблемы</h2><p className="muted">Опишите процесс, трудности и то, что хотите изменить. Остальное уточним вместе.</p></div>
          <label className="field" htmlFor="draft-input"><span>Опишите бизнес-задачу в свободной форме</span><textarea id="draft-input" rows={8} value={draft} disabled={loading || activeRole !== 'business'} placeholder="Мы хотим автоматизировать… Сейчас процесс устроен так…" onChange={(event) => updateDraft(event.target.value)} /></label>
          <div className="form-grid">
            <label className="field" htmlFor="draft-industry"><span>Отрасль</span><select id="draft-industry" value={task.industry} disabled={loading || activeRole !== 'business'} onChange={(event) => updateDraft(draft, event.target.value)}>{industries.map((industry) => <option key={industry}>{industry}</option>)}</select></label>
            <label className="field" htmlFor="draft-example"><span>Попробовать на примере</span><select id="draft-example" value="" disabled={loading || activeRole !== 'business'} onChange={(event) => { const example = seedTasks.find((item) => item.id === event.target.value); if (example) updateDraft(example.rawDraft || example.context, example.industry); }}><option value="">Выберите пример черновика</option>{seedTasks.filter((item) => !item.published).map((example) => <option key={example.id} value={example.id}>{example.industry} · {example.title}</option>)}</select></label>
          </div>
          <div className="button-row"><Button disabled={loading || !draft.trim() || activeRole !== 'business'} onClick={() => void runAnalysis()}>{loading ? 'Анализируем задачу…' : 'Проанализировать с AI →'}</Button><Button variant="ghost" disabled={loading || !draft.trim()} onClick={() => { if (!task.context.trim()) updateField('context', draft.trim(), 'draft'); openEditor(); }}>Заполнить самостоятельно</Button></div>
          {loading && <p role="status" className="muted">Проверяем черновик и готовим вопросы. Обычно это занимает несколько секунд.</p>}
        </section>}

        {stage === 1 && <section className="panel stack">
          <div><span className="eyebrow">ШАГ 02</span><h2>Добавим конкретики</h2><p className="muted">Заполнено {TASK_FIELDS.length - emptyFields.length}/{TASK_FIELDS.length} полей. {emptyFields.length ? `Требует уточнения: ${emptyFields.length}.` : 'Проверьте ответы перед следующим шагом.'}</p></div>
          {analysis?.fallbackUsed && <div className="notice notice-warning" role="status"><strong>Локальный режим уточнения</strong><p>{analysis.reason} Извлекли явно указанные сведения и подготовили уточняющие вопросы.</p><Button variant="ghost" disabled={loading} onClick={() => void runAnalysis()}>{loading ? 'Повторяем запрос…' : 'Повторить AI-анализ'}</Button></div>}
          {analysis && !analysis.fallbackUsed && <div className="notice">Поля извлечены с помощью {analysis.provider}. Подтвердите сведения своими ответами.</div>}
          <div className="button-row"><Button variant="secondary" onClick={fillExamples} disabled={activeRole !== 'business' || loading}>Заполнить примерные ответы</Button><span className="muted">Демонстрационный пример для Retail</span></div>
          {exampleAnswers && <div className="notice notice-warning">Использованы синтетические ответы для демонстрации. Замените их реальными сведениями перед подтверждением.</div>}
          <div className="clarification-list">{questions.map((question, index) => {
            const field = TASK_FIELDS.find((item) => item.key === question.field);
            if (!field) return null;
            return <label className="field clarification-question" key={question.field} htmlFor={`answer-${question.field}`}><span className="question-heading"><span className="question-number">{index + 1}</span><span>{question.question}</span></span><span className="tags"><Badge>{field.label}</Badge>{task[field.key].trim() && <Badge>{sourceLabels[task.fieldSources?.[field.key] || 'manual']}</Badge>}</span><textarea id={`answer-${question.field}`} rows={2} value={task[field.key]} disabled={activeRole !== 'business' || loading} onChange={(event) => updateField(field.key, event.target.value, 'clarification')} placeholder="Ваш ответ…" /></label>;
          })}</div>
          <div className="button-row"><Button onClick={() => { setStage(2); useAppStore.getState().recordEvent('Уточнение завершено', `${TASK_FIELDS.length - emptyFields.length}/10 полей заполнено`); }} disabled={loading}>Продолжить к карточке →</Button><Button variant="ghost" onClick={() => setStage(0)} disabled={loading}>Назад</Button></div>
        </section>}

        {stage === 2 && <section className="panel stack">
          <div><span className="eyebrow">ШАГ 03</span><h2>Карточка вашей задачи</h2><p className="muted">Уточните формулировки. Источник каждого поля указан рядом с названием.</p></div>
          {exampleAnswers && <div className="notice notice-warning">В карточке есть демонстрационные данные. Проверьте каждое поле.</div>}
          {TASK_FIELDS.map(({ key, label }) => <label key={key} className="field" htmlFor={`task-field-${key}`}><span className="field-title"><span>{label}</span>{task[key].trim() && <Badge>{sourceLabels[task.fieldSources?.[key] || 'manual']}</Badge>}</span>{key === 'title' || key === 'contact' ? <input id={`task-field-${key}`} value={task[key]} disabled={activeRole !== 'business'} onChange={(event) => updateField(key, event.target.value, 'manual')} /> : <textarea id={`task-field-${key}`} rows={3} value={task[key]} disabled={activeRole !== 'business'} onChange={(event) => updateField(key, event.target.value, 'manual')} />}</label>)}
          <label className="field" htmlFor="task-tags"><span>Технологии и навыки, через запятую</span><input id="task-tags" value={tagsText} disabled={activeRole !== 'business'} onChange={(event) => {
            setTagsText(event.target.value);
            save({ ...task, tags: [...new Set(event.target.value.split(',').map(value => value.trim()).filter(Boolean))] });
          }} onBlur={() => setTagsText(task.tags.join(', '))} placeholder="Python, Analytics, React" /></label>
          <div className="button-row"><Button onClick={() => setStage(3)}>Проверить готовность →</Button><Button variant="ghost" onClick={() => setStage(1)}>Назад к вопросам</Button></div>
        </section>}

        {stage === 3 && <section className="panel stack">
          <div><span className="eyebrow">ШАГ 04</span><h2>Проверьте перед публикацией</h2><p className="muted">{task.title || 'Задача пока без названия'}</p></div>
          <div className="confirmation-score"><strong>{rating.total}<small>/100</small></strong><ReadinessBadge score={rating.total} /></div>
          <p>В рейтинг входят подтверждённые сведения. После подтверждения текущих полей оценка составит {rating.potentialTotal}/100. Низкий балл не мешает публикации: команда сможет уточнить детали в отклике.</p>
          {exampleAnswers && <div className="notice notice-warning">Вы добавили демонстрационные ответы. Подтверждая карточку, вы подтверждаете и эти сведения.</div>}
          {task.confirmed ? <div className="notice"><strong>Карточка подтверждена бизнесом.</strong><p>Теперь её можно опубликовать в каталоге.</p></div> : <><label className="consent-field"><input type="checkbox" checked={consent} disabled={activeRole !== 'business'} onChange={(event) => setConsent(event.target.checked)} /><span>Я подтверждаю корректность информации в карточке</span></label><Button disabled={!consent || activeRole !== 'business'} onClick={confirm}>Подтвердить карточку</Button></>}
          <div className="button-row"><Button disabled={!task.confirmed || activeRole !== 'business'} onClick={() => setStage(4)}>Перейти к публикации →</Button><Button variant="ghost" onClick={() => openEditor()}>Редактировать карточку</Button></div>
          <p className="muted">Любое изменение карточки потребует повторного подтверждения.</p>
        </section>}

        {stage === 4 && <section className="panel stack">
          <div><span className="eyebrow">ШАГ 05</span><h2>{task.published ? 'Задача открыта для команд' : 'Всё готово к публикации'}</h2><p className="muted">{task.title || 'Добавьте название вашей задачи'}</p></div>
          {task.published ? <><div className="notice">Карточка опубликована. Студенческие команды могут изучить задачу и отправить предложение.</div><div className="button-row"><Button onClick={() => useAppStore.getState().navigate('catalog')}>Открыть каталог →</Button><Button variant="secondary" onClick={() => useAppStore.getState().navigate('tasks')}>Мои задачи</Button></div></> : <><p>После публикации карточка появится в общем каталоге. Решение о выборе команды останется за вами.</p>{!task.confirmed && <div className="notice notice-warning">Сначала подтвердите корректность карточки на предыдущем шаге.</div>}<div className="button-row"><Button disabled={!task.confirmed || activeRole !== 'business'} onClick={() => { if (useAppStore.getState().publishTask(task.id)) useAppStore.getState().notify('Задача опубликована и доступна в каталоге.'); }}>Опубликовать задачу</Button><Button variant="ghost" onClick={() => setStage(3)}>К подтверждению</Button></div></>}
        </section>}
      </div>
      <RatingPanel task={task} onImprove={openEditor} />
    </div>
  </div>;
}

export default TaskBuilder;
