import { useAppStore } from '../../app/store';
export function ActivityTimeline() {
  const events = useAppStore(s=>s.events);
  return <section className="panel"><div className="section-heading"><h3>Лента событий</h3><span className="eyebrow" style={{margin:0}}>ACTIVITY</span></div>{events.length===0 ? <p className="muted">Создайте задачу — здесь появится история проекта.</p> : <ol className="activity-list">{events.slice(0,8).map(event=><li key={event.id} className="activity-item"><span className="activity-dot"/><div><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}</div></li>)}</ol>}</section>;
}
