import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAppStore } from './app/store';
import AuthPage from './features/auth/AuthPage';
import PlatformWorkspace from './PlatformWorkspace';
import type { Account } from './types/auth';

const DesignLab = lazy(() => import('./features/design/DesignLab'));
type DesignTheme = 'signal' | 'atelier' | 'index';
type View = 'account' | 'workspace' | 'design';
function savedDesign(): DesignTheme {
  try {
    const value = window.localStorage.getItem('ai-sana-design');
    if (value === 'atelier' || value === 'index') return value;
  } catch { /* Theme selection remains usable without persistent storage. */ }
  return 'signal';
}
function hasAuthCallback() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  return ['verify', 'reset', 'token_hash', 'code', 'access_token', 'refresh_token', 'error', 'error_code']
    .some(key => url.searchParams.has(key) || hash.has(key));
}
function locationView(): View {
  if (hasAuthCallback()) return 'account';
  const path = window.location.pathname.replace(/\/$/, '');
  return path === '/design' ? 'design' : path === '/workspace' ? 'workspace' : 'account';
}

function Application() {
  const [view, setView] = useState<View>(locationView);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountEntry, setAccountEntry] = useState(0);
  const [theme, setTheme] = useState<DesignTheme>(savedDesign);

  useEffect(() => { document.documentElement.dataset.design = theme; }, [theme]);
  useEffect(() => {
    const onLocationChange = (event: Event) => {
      // Anchor links for keyboard navigation do not restart auth initialization.
      if (event.type === 'hashchange' && !hasAuthCallback()) return;
      const next = locationView();
      if (next === 'account') {
        setAccount(null);
        setAccountEntry(value => value + 1);
      }
      setView(next);
    };
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);

  function navigate(next: View) {
    const path = next === 'account' ? '/auth' : next === 'design' ? '/design' : '/workspace';
    window.history.pushState(window.history.state, '', path);
    if (next === 'account') {
      setAccount(null);
      setAccountEntry(value => value + 1);
    }
    setView(next);
  }
  function openWorkspace(current: Account | null) {
    const state = useAppStore.getState();
    state.setDemoStep(0);
    if (current) state.setActiveRole(current.role === 'student' ? 'student' : 'business');
    state.setDemoEnabled(!current);
    setAccount(current);
    navigate('workspace');
  }
  function applyDesign(design: DesignTheme) {
    setTheme(design);
    try { window.localStorage.setItem('ai-sana-design', design); } catch { /* Apply to this tab anyway. */ }
    navigate('workspace');
  }

  if (view === 'design') return <Suspense fallback={<main className="sana-app-error" role="status">Открываем дизайн-системы…</main>}><DesignLab onBack={() => navigate('workspace')} onApply={applyDesign} /></Suspense>;
  if (view === 'workspace') return <PlatformWorkspace account={account} onAccount={() => navigate('account')} onDesign={() => navigate('design')} />;
  return <AuthPage key={accountEntry} onDemo={() => openWorkspace(null)} onWorkspace={openWorkspace} />;
}

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="sana-app-error"><h1>Не удалось открыть приложение</h1><p>Перезагрузите страницу. Сохранённые задачи останутся в этом браузере.</p><button onClick={() => window.location.reload()}>Перезагрузить</button></main>;
  }
}

export default function App() { return <AppBoundary><Application /></AppBoundary>; }
