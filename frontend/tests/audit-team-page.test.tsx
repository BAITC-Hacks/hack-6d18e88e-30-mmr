import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';

test('several selected proposals for one task/team display one project and one milestone ledger', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const { createRoot } = await import('react-dom/client');
  const { TeamPage } = await import('../src/features/student/TeamPage.tsx');
  const { useAppStore } = await import('../src/app/store.ts');
  const state = useAppStore.getState();
  const team = state.teams[0]; const task = state.tasks[0];
  useAppStore.setState({ activeRole: 'student', activeTeamId: team.id,
    proposals: ['selected-a', 'selected-b'].map(id => ({ id, taskId: task.id, teamId: team.id, idea: 'Approach', implementationPlan: 'Plan', estimatedTime: '14 days', prototypeUrl: '', status: 'selected', createdAt: new Date().toISOString() })),
    milestones: [{ id: 'shared-project-stage', taskId: task.id, teamId: team.id, title: 'One shared stage', description: 'Agreed work', status: 'pending', points: 10 }],
  });
  const host = document.getElementById('root')!; const root = createRoot(host);
  try {
    await act(async () => root.render(<TeamPage />));
    assert.equal(host.querySelectorAll('article.panel').length, 1);
    assert.equal(host.querySelectorAll('.milestone-list li').length, 1);
    assert.match(host.textContent || '', /1 активных/);
    assert.match(host.textContent || '', /One shared stage/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
