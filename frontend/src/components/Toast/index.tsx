import { useEffect } from 'react';
import { useAppStore } from '../../app/store';
import { Icon } from '../Icon';
export function Toast() { const toast = useAppStore(s=>s.toast); const notify = useAppStore(s=>s.notify); useEffect(()=>{ if (!toast) return; const timer = setTimeout(()=>notify(null),5500); return ()=>clearTimeout(timer); },[toast,notify]); return toast ? <div className="toast" role="status"><Icon name="chat" /><span>{toast}</span><button className="icon-button" aria-label="Скрыть уведомление" onClick={()=>notify(null)}><Icon name="close" size={16}/></button></div> : null; }
