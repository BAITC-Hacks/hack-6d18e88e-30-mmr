import { Component, type ReactNode } from 'react';
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
import type { Account } from './types/auth';
import './styles/tokens.css';
import './styles/global.css';
import './styles/animations.css';
import './styles/shell.css';

type Page = ReturnType<typeof useAppStore.getState>['page'];
const businessNav: [Page,string,string][] = [['overview','Обзор','grid'],['builder','Создать задачу','plus'],['tasks','Мои задачи','folder'],['proposals','Отклики','chat']];
const studentNav: [Page,string,string][] = [['catalog','Каталог задач','grid'],['recommendations','Рекомендации','spark'],['my-proposals','Мои отклики','chat'],['team','Моя команда','users']];
interface PlatformWorkspaceProps { account?: Account | null; onAccount?: () => void }
function Application({ account, onAccount }: PlatformWorkspaceProps) {
  const s = useAppStore();
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
      <button className="brand" onClick={()=>navigate(s.activeRole==='business'?'overview':'catalog')} aria-label="AI Sana — главная"><span className="brand-mark"><Icon name="leaf" size={26}/></span><span>AI Sana<span className="brand-subtitle">TASKRANK & TEAMMATCH</span></span></button>
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">{nav.map(([page,title,icon])=><button key={page} className={`nav-item ${s.page===page ? 'active':''}`} aria-current={s.page===page?'page':undefined} onClick={()=>navigate(page)}><Icon name={icon} size={19}/><span>{title}</span>{page==='proposals' && <span className="nav-count">{s.proposals.filter(p=>p.status==='pending').length}</span>}</button>)}</nav>
      <div className="nav-divider"/>
      <nav aria-label="Инструменты">{onAccount && <button className="nav-item" onClick={onAccount}><Icon name="users" size={19}/><span>{account ? 'Мой профиль' : 'Войти / профиль'}</span></button>}<button className={`nav-item ${s.page==='inspector'?'active':''}`} onClick={()=>navigate('inspector')}><Icon name="code" size={19}/><span>AI Inspector</span></button><button className="nav-item" aria-pressed={s.demoEnabled} onClick={()=>s.setDemoEnabled(!s.demoEnabled)}><Icon name="play" size={19}/><span>Demo Mode</span><span className={`toggle-dot ${s.demoEnabled?'on':''}`}/></button></nav>
      <div className="sidebar-note"><Icon name="leaf" size={25}/><h3>Идеи становятся делом.</h3><p>Бизнес ставит задачу.<br/>Команды создают решение.</p><span>HACKALEM · AI SANA</span></div>
      <div className="sidebar-footer"><span className="avatar">{account ? Array.from(account.full_name.trim())[0]?.toLocaleUpperCase('ru') : s.activeRole==='business'?'Б':'С'}</span><div><strong>{account?.full_name || 'Гостевой просмотр'}</strong><small>Локальное демо платформы</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Пространство <span>/</span> <strong>{label}</strong></div><div className="topbar-actions"><span className="live-label"><span/> {published} задач в каталоге</span><div className="role-switch" aria-label="Роль в демонстрационном сценарии"><button aria-pressed={s.activeRole==='business'} className={s.activeRole==='business'?'selected':''} onClick={()=>{s.setDemoStep(0);s.setActiveRole('business');}}>Бизнес</button><button aria-pressed={s.activeRole==='student'} className={s.activeRole==='student'?'selected':''} onClick={()=>{s.setDemoStep(0);s.setActiveRole('student');}}>Студент</button></div></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}><div className="notice workspace-demo-note"><strong>Демо платформы.</strong> Задачи, отклики и прогресс сохраняются только в этом браузере. Переключатель «Бизнес / Студент» меняет роль сценария; общий каталог между устройствами пока не подключён.</div>{s.storageError && <div className="notice notice-warning storage-warning" role="alert">{s.storageError}</div>}{content}<footer className="page-footer"><span>AI Sana · Возможности для совместного роста</span><span>TaskRank & TeamMatch / 2026</span></footer></main>
    </div><DemoBar/><Toast/>
  </div>;
}
class AppBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  render() { return this.state.failed ? <main className="app-shell panel" style={{margin:'10vh auto',maxWidth:600}}><h1>Не удалось открыть экран</h1><p>Перезагрузите приложение. Сохранённые задачи останутся в этом браузере.</p><Button onClick={()=>window.location.reload()}>Перезагрузить</Button></main> : this.props.children; }
}
export default function PlatformWorkspace(props: PlatformWorkspaceProps) { return <AppBoundary><Application {...props}/></AppBoundary>; }
