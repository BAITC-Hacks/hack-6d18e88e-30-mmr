import assert from 'node:assert/strict';
import { analyzeDraft, generateCardFromAnswers } from '../frontend/src/services/aiClient';
import { calculateRating } from '../frontend/src/services/ratingService';
import { getRecommendedTasksForTeam } from '../frontend/src/services/teamMatchService';
import { useAppStore } from '../frontend/src/app/store';
import type { Task } from '../frontend/src/types/task';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Offline demo'); };
try {
  useAppStore.getState().resetDemo();
  const draft = 'Нужен бот для заказов';
  assert.ok((await analyzeDraft(draft)).questions.length >= 3);
  const answers = [
    ['context', 'Сейчас менеджер вручную переносит заказы из чата в таблицу, теряя обращения клиентов.'],
    ['need', 'Нужно автоматизировать приём заказов и передачу подтверждённой заявки менеджеру магазина.'],
    ['targetUsers', 'Клиенты магазина и менеджеры обработки заказов.'],
    ['availableData', 'Предоставим CSV с каталогом из 100 товаров и 50 обезличенными примерами заказов.'],
    ['expectedResult', 'Telegram-бот на Python с каталогом и оформлением заказа, исходный код и инструкция.'],
    ['successCriteria', 'Не менее 95% из 50 тестовых заказов оформляются без участия менеджера.'],
    ['constraints', 'Срок 2 недели; Python; только синтетические данные без реальных платежей.'],
    ['contact', 'Куратор магазина: demo@example.com'],
    ['consultationFormat', 'Созвон по понедельникам, вопросы в чате, обратная связь в течение одного дня.'],
  ].map(([field, answer]) => ({ field, answer, questionId: `q-${field}` }));
  const card = await generateCardFromAnswers({ draft, industry: 'Retail', answers });
  assert.ok(calculateRating(card as Task).total >= 90, 'Structured answers produce a live readiness score before approval');
  assert.equal(calculateRating(card as Task).potentialTotal, 100);
  useAppStore.getState().addTask(card as Task);
  const id = card.id!;
  const currentTask = () => useAppStore.getState().tasks.find(task => task.id === id)!;
  useAppStore.getState().publishTask(id);
  assert.equal(currentTask().published, false);
  useAppStore.getState().confirmTask(id);
  assert.equal(currentTask().rating, calculateRating(currentTask()).total);
  useAppStore.getState().publishTask(id);
  assert.equal(currentTask().published, true);

  const team = useAppStore.getState().teams[0];
  assert.ok(getRecommendedTasksForTeam(team, useAppStore.getState().tasks).some(item => item.task.id === id));
  useAppStore.getState().setActiveRole('student');
  useAppStore.getState().setActiveTeam(team.id);
  useAppStore.getState().addProposal({
    id: 'flow-proposal', taskId: id, teamId: team.id, idea: 'Бот для каталога и заказов',
    implementationPlan: 'Каталог, оформление, тестовые заказы', estimatedTime: '2 недели',
    prototypeUrl: '', status: 'pending', createdAt: new Date().toISOString(),
  });
  assert.equal(useAppStore.getState().proposals.find(p => p.id === 'flow-proposal')?.status, 'pending');
  assert.equal(useAppStore.getState().teams[0].progressPoints, team.progressPoints);
  useAppStore.getState().setActiveRole('business');
  useAppStore.getState().selectProposal('flow-proposal');
  const milestone = useAppStore.getState().milestones.find(m => m.taskId === id && m.teamId === team.id)!;
  assert.ok(milestone);
  useAppStore.getState().confirmMilestone(milestone.id);
  useAppStore.getState().confirmMilestone(milestone.id);
  assert.equal(useAppStore.getState().teams[0].progressPoints, team.progressPoints + milestone.points);
  const beforeEdit = currentTask().rating;
  const dataPoints = calculateRating(currentTask()).data;
  useAppStore.getState().updateTask({ ...currentTask(), availableData: '' });
  assert.equal(currentTask().rating, beforeEdit - dataPoints);
  assert.equal(currentTask().confirmed, false);
  assert.equal(currentTask().published, false);
  console.log('Offline core flow passed: draft → questions → card → live rating → business confirmation → publish → proposal → manual selection → progress once.');
} finally {
  globalThis.fetch = originalFetch;
  useAppStore.getState().resetDemo();
}
