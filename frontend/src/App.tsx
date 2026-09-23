import { Component, useState, type ReactNode } from 'react';
import { useAppStore } from './app/store';
import AuthPage from './features/auth/AuthPage';
import PlatformWorkspace from './PlatformWorkspace';
import type { Account } from './types/auth';

function Application() {
  const [workspace, setWorkspace] = useState<{ account: Account | null } | null>(null);

  function openWorkspace(account: Account | null) {
    const state = useAppStore.getState();
    state.setDemoStep(0);
    if (account) state.setActiveRole(account.role === 'student' ? 'student' : 'business');
    state.setDemoEnabled(!account);
    setWorkspace({ account });
  }

  if (workspace) return <PlatformWorkspace account={workspace.account} onAccount={() => setWorkspace(null)} />;
  return <AuthPage onDemo={() => openWorkspace(null)} onWorkspace={openWorkspace} />;
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
