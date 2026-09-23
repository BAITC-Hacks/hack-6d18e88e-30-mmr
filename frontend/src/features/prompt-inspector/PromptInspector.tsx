import { useEffect, useState } from 'react';
import { ANALYSIS_PROMPT, getPromptInspectorSnapshot, useAiInspectorStore } from '../../services/aiClient';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../app/store';

const tabs = ['Prompt провайдера', 'Контракт клиента', 'Input', 'Output Schema', 'Latest Response', 'Validation'] as const;
type Snapshot = Awaited<ReturnType<typeof getPromptInspectorSnapshot>>;

export function PromptInspector() {
  const latest = useAiInspectorStore(state => state.latest);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Prompt провайдера');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const navigate = useAppStore(state => state.navigate);

  useEffect(() => {
    const controller = new AbortController();
    void getPromptInspectorSnapshot({ signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setSnapshot(result);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить описание AI.');
    });
    return () => controller.abort();
  }, []);

  const content = tab === 'Prompt провайдера' ? snapshot?.data
    : tab === 'Контракт клиента' ? ANALYSIS_PROMPT
    : !latest ? null
    : { Input: latest.input, 'Output Schema': latest.outputSchema,
      'Latest Response': { received: latest.response, used: latest.normalizedResponse }, Validation: latest.validation }[tab];

  return <div className="stack">
    <div className="page-heading"><p className="eyebrow">AI TRANSPARENCY</p><h1>Понятно, как работает AI</h1><p>Prompt сервера, контракт клиента и проверенный результат последнего анализа.</p></div>
    {!snapshot && !error && <p role="status">Загружаем описание AI с сервера…</p>}
    {error && <div className="notice notice-warning" role="alert">{error}</div>}
    {snapshot && <div className="notice" role="status">
      <strong>{snapshot.source === 'server' ? 'Prompt и схема получены с сервера' : 'Описание локального алгоритма'}</strong>
      <p>{snapshot.source === 'server'
        ? 'Это текущая конфигурация анализа. Наличие prompt не означает, что последний запрос выполнила внешняя модель: источник указан в результате ниже.'
        : 'Сервер не предоставил описание либо включён локальный режим. Внешняя модель не вызывается; здесь показаны правила локального извлечения.'}</p>
    </div>}
    {!latest ? <EmptyState title="Пока нет завершённого анализа" description="Проанализируйте черновик в конструкторе, чтобы увидеть его входные данные, ответ и проверку." action={<Button onClick={() => navigate('builder')}>Открыть конструктор</Button>} /> : <>
      <div className="metrics">
        <div className="metric"><span className="muted">Источник ответа</span><h3 style={{ marginTop: 12 }}>{latest.provider}</h3><Badge variant={latest.fallbackUsed ? 'warning' : 'success'}>{latest.fallbackUsed ? 'Локальный fallback' : 'Ответ сервера'}</Badge></div>
        <div className="metric"><span className="muted">Проверка ответа сервера</span><p style={{ marginTop: 12 }}>JSON: {latest.validation.jsonValid ? 'корректен' : 'не получен / некорректен'}</p><p>Schema: {latest.validation.schemaValid ? 'пройдена' : 'не пройдена'}</p></div>
        <div className="metric"><span className="muted">Длительность запроса</span><strong>{Math.round(latest.durationMs)} <small style={{ fontSize: 14 }}>мс</small></strong></div>
      </div>
      {latest.reason && <div className="notice notice-warning">{latest.reason}</div>}
    </>}
    <section className="panel">
      <div className="inspector-tabs" role="tablist" aria-label="Данные AI-запроса">
        {tabs.map((name, index) => <Button key={name} role="tab" tabIndex={name === tab ? 0 : -1} aria-selected={name === tab} aria-controls="inspector-panel" id={`inspector-tab-${index}`} variant={name === tab ? 'primary' : 'ghost'} onClick={() => setTab(name)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); setTab(tabs[next]);
          document.getElementById(`inspector-tab-${next}`)?.focus();
        }}>{name}</Button>)}
      </div>
      <pre className="inspector-code" id="inspector-panel" role="tabpanel" tabIndex={0} aria-labelledby={`inspector-tab-${tabs.indexOf(tab)}`}>{content == null ? (tab === 'Prompt провайдера' ? error || 'Описание AI загружается…' : 'Сначала завершите анализ черновика.') : typeof content === 'string' ? content : JSON.stringify(content, null, 2)}</pre>
      <p className="muted">Факты проверяет и подтверждает бизнес. Полученный ответ и использованный результат показаны отдельно.</p>
    </section>
  </div>;
}
