import { useAppStore } from '../../app/store';
import { sessions } from './builderSessions';

/** Open an existing card without creating a task or changing its approvals. */
export function openTaskEditor(taskId: string) {
  const state = useAppStore.getState();
  if (state.activeRole !== 'business' || !state.tasks.some(task => task.id === taskId)) return;
  const previous = sessions.get(taskId);
  sessions.set(taskId, { stage: 2, analysis: previous?.analysis ?? null, exampleAnswers: previous?.exampleAnswers ?? false });
  state.setDemoStep(0);
  state.setActiveTask(taskId);
  state.navigate('builder');
}
