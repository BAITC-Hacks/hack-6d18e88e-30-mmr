import { useAppStore } from './app/store';

function App() {
  const activeRole = useAppStore((state) => state.activeRole);
  const setActiveRole = useAppStore((state) => state.setActiveRole);

  return (
    <div className="app">
      <header>
        <h1>AI Sana — TaskRank & TeamMatch</h1>
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
      </main>
    </div>
  );
}

export default App;
