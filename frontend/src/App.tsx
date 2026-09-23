import { useState } from 'react';
import { useAppStore } from './app/store';
import AuthPage from './features/auth/AuthPage';

function App() {
  const [demo, setDemo] = useState(false);
  const activeRole = useAppStore((state) => state.activeRole);
  const setActiveRole = useAppStore((state) => state.setActiveRole);

  if (!demo) return <AuthPage onDemo={() => setDemo(true)} />;

  return (
    <div className="demo-shell">
      <header>
        <h1>AI Sana — TaskRank & TeamMatch</h1>
        <p>Демонстрационный режим</p>
        <div>
          <button onClick={() => setActiveRole('business')}>
            Business
          </button>
          <button onClick={() => setActiveRole('student')}>
            Student
          </button>
        </div>
      </header>
      <main>
        <p>Current role: {activeRole}</p>
        <button type="button" onClick={() => setDemo(false)}>Вернуться к аккаунту</button>
      </main>
    </div>
  );
}

export default App;
