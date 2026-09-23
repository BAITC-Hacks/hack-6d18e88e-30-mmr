import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from './app/store';
import { createEmptyTask } from './data/syntheticData';
import { Icon } from './components/Icon';
import { Toast } from './components/Toast';
import { Button } from './components/Button';
import TaskBuilder from './features/builder/TaskBuilder';
import { Catalog } from './features/catalog/Catalog';
import { BusinessHub } from './features/business/BusinessHub';
import { MyProposals } from './features/proposals/MyProposals';
import { TeamPage } from './features/student/TeamPage';
import { MilestoneTracker } from './features/milestones/MilestoneTracker';
import { DemoBar } from './features/demo/DemoBar';
import { PromptInspector } from './features/prompt-inspector/PromptInspector';
import './styles/shell.css';
import './styles/design.css';

const AuthPage = lazy(() => import('./features/auth/AuthPage'));
const DesignLab = lazy(() => import('./features/design/DesignLab'));
type DesignTheme = 'signal' | 'atelier' | 'index';
function savedDesign(): DesignTheme {
  try {
    const value = window.localStorage.getItem('ai-sana-design');
    if (value === 'atelier' || value === 'index') return value;
  } catch { /* The default remains usable with blocked browser storage. */ }
  return 'signal';
}

function isAccountLocation() {
  const url = new URL(window.location.href);
  if (['/auth', '/auth/', '/auth/callback', '/auth/reset-password', '/account'].includes(url.pathname)) return true;
  const hash = new URLSearchParams(url.hash.slice(1));
  return ['verify', 'reset', 'token_hash', 'code', 'access_token', 'refresh_token', 'error', 'error_code']
    .some(key => url.searchParams.has(key) || hash.has(key));
}

type Page = ReturnType<typeof useAppStore.getState>['page'];
const businessNav: [Page,string,string][] = [['overview','Обзор','grid'],['builder','Создать задачу','plus'],['tasks','Мои задачи','folder'],['proposals','Отклики','chat']];
const studentNav: [Page,string,string][] = [['catalog','Каталог задач','grid'],['recommendations','Рекомендации','spark'],['my-proposals','Мои отклики','chat'],['team','Моя команда','users']];
function Application({ onAccount, onDesign }: { onAccount: () => void; onDesign: () => void }) {
  const s = useAppStore();
  const screen = `${s.activeRole}:${s.page}:${s.page === 'builder' ? s.activeTaskId : s.page === 'proposals' && s.demoStep === 8 ? 'milestones' : ''}`;
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [screen]);
  function navigate(page: Page) {
    s.setDemoStep(0);
    if (page === 'builder') { const task = createEmptyTask(); s.addTask(task); s.setActiveTask(task.id); }
    s.navigate(page);
  }
  const nav = s.activeRole === 'business' ? businessNav : studentNav;
  const label = [...businessNav,...studentNav].find(([page])=>page===s.page)?.[1] ?? 'AI Inspector';
  const published = s.tasks.filter(t=>t.published).length;
  let content: ReactNode;
  switch(s.page) {
    case 'builder': content = <TaskBuilder key={s.activeTaskId ?? 'new'} />; break;
    case 'catalog': content = <Catalog />; break;
    case 'recommendations': content = <Catalog recommendations />; break;
    case 'my-proposals': content = <MyProposals />; break;
    case 'team': content = <TeamPage />; break;
    case 'inspector': content = <PromptInspector />; break;
    case 'proposals': content = s.demoStep === 8 ? <div className="stack"><div className="page-heading"><p className="eyebrow">08 / РЕАЛЬНЫЙ ПРОГРЕСС</p><h1>От идеи к результату</h1><p>Подтверждайте этапы выбранных команд. Баллы начисляются за выполненную работу.</p></div><MilestoneTracker taskId={s.activeTaskId ?? undefined} /><Button variant="secondary" onClick={()=>s.setDemoStep(7)}>К выбору команды</Button></div> : <BusinessHub view="proposals" />; break;
    case 'tasks': content = <BusinessHub view="tasks" />; break;
    default: content = <BusinessHub view="overview" />;
  }
  return <div className={`app-shell ${s.demoEnabled ? 'with-demo' : ''}`}>
    <a href="#main-content" className="skip-link">Перейти к содержимому</a>
    <aside className="sidebar">
      <button className="brand" onClick={()=>navigate(s.activeRole==='business'?'overview':'catalog')} aria-label="AI Sana — главная"><span className="brand-mark"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M6 8h13l7 8-7 8H6l7-8Z" fill="currentColor"/><path d="m17 8-7 8 7 8" fill="none" stroke="var(--ink)" strokeWidth="2.5"/></svg></span><span>AI Sana<span className="brand-subtitle">ИДЕИ С ПРОДОЛЖЕНИЕМ</span></span></button>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">{nav.map(([page,title,icon])=><button key={page} className={`nav-item ${s.page===page ? 'active':''}`} aria-current={s.page===page?'page':undefined} onClick={()=>navigate(page)}><Icon name={icon} size={19}/><span>{title}</span>{page==='proposals' && <span className="nav-count">{s.proposals.filter(p=>p.status==='pending').length}</span>}</button>)}</nav>
      <div className="nav-divider"/>
      <nav aria-label="Инструменты"><button className="nav-item" onClick={onAccount}><Icon name="users" size={19}/><span>Аккаунт</span></button><button className="nav-item" onClick={onDesign}><Icon name="grid" size={19}/><span>Дизайн-системы</span></button><button className={`nav-item ${s.page==='inspector'?'active':''}`} onClick={()=>navigate('inspector')}><Icon name="code" size={19}/><span>AI Inspector</span></button><button className="nav-item" aria-pressed={s.demoEnabled} onClick={()=>s.setDemoEnabled(!s.demoEnabled)}><Icon name="play" size={19}/><span>Demo Mode</span><span className={`toggle-dot ${s.demoEnabled?'on':''}`}/></button></nav>
      <div className="sidebar-note"><span className="sidebar-note-index">01 → ∞</span><h3>Одна задача.<br/>Много возможностей.</h3><p>Объединяем опыт бизнеса<br/>и энергию команд.</p><span>HACKALEM · AI SANA</span></div>
      <div className="sidebar-footer"><span className="avatar">{s.activeRole==='business'?'Б':'С'}</span><div><strong>{s.activeRole==='business'?'Бизнес-пространство':'Студенческая команда'}</strong><small>Демонстрационный профиль</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Пространство <span>/</span> <strong>{label}</strong></div><div className="topbar-actions"><span className="live-label"><span/> {published} задач в каталоге</span><div className="role-switch" aria-label="Роль пользователя"><button aria-pressed={s.activeRole==='business'} className={s.activeRole==='business'?'selected':''} onClick={()=>{s.setDemoStep(0);s.setActiveRole('business');}}>Бизнес</button><button aria-pressed={s.activeRole==='student'} className={s.activeRole==='student'?'selected':''} onClick={()=>{s.setDemoStep(0);s.setActiveRole('student');}}>Студент</button></div></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>{s.storageError && <div className="notice notice-warning storage-warning" role="alert">{s.storageError}</div>}{content}<footer className="page-footer"><span>AI Sana · Возможности для совместного роста</span><span>TaskRank & TeamMatch / 2026</span></footer></main>
    </div><DemoBar/><Toast/>
  </div>;
}
class AppBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  render() { return this.state.failed ? <main className="panel" style={{margin:'10vh auto',maxWidth:600}}><h1>Не удалось открыть экран</h1><p>Перезагрузите приложение. Сохранённые задачи останутся в этом браузере.</p><Button onClick={()=>window.location.reload()}>Перезагрузить</Button></main> : this.props.children; }
}
export default function App() {
  const [view, setView] = useState<'app' | 'account' | 'design'>(() => window.location.pathname.replace(/\/$/, '') === '/design' ? 'design' : isAccountLocation() ? 'account' : 'app');
  const [theme, setTheme] = useState<DesignTheme>(savedDesign);
  useEffect(() => { document.documentElement.dataset.design = theme; }, [theme]);
  useEffect(() => {
    const onLocationChange = () => setView(window.location.pathname.replace(/\/$/, '') === '/design' ? 'design' : isAccountLocation() ? 'account' : 'app');
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);
  function openAccount(visible: boolean) {
    window.history.pushState(window.history.state, '', visible ? '/auth' : '/');
    setView(visible ? 'account' : 'app');
  }
  function applyDesign(design: DesignTheme) {
    setTheme(design);
    try { window.localStorage.setItem('ai-sana-design', design); } catch { /* Current tab still changes theme. */ }
    openAccount(false);
  }
  function openDesign() { window.history.pushState(window.history.state, '', '/design'); setView('design'); }
  return <AppBoundary>{view === 'design'
    ? <Suspense fallback={<main className="panel" role="status">Открываем дизайн-системы…</main>}><DesignLab onBack={() => openAccount(false)} onApply={applyDesign} /></Suspense>
    : view === 'account'
    ? <Suspense fallback={<main className="panel" role="status"><p>Открываем аккаунт…</p><Button onClick={() => openAccount(false)}>Открыть демо</Button></main>}><AuthPage onDemo={() => openAccount(false)} /></Suspense>
    : <Application onAccount={() => openAccount(true)} onDesign={openDesign} />}</AppBoundary>;
}
