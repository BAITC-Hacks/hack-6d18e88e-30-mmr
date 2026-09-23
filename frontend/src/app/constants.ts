import type { RatingBreakdown } from '../types/rating';
import type { ReadinessLevel } from '../types/task';

export const INDUSTRIES = ['Retail', 'Education', 'FinTech', 'Healthcare', 'Logistics'] as const;

export const TASK_FIELDS = [
  { key: 'title', label: 'Название' },
  { key: 'context', label: 'Контекст' },
  { key: 'need', label: 'Потребность' },
  { key: 'targetUsers', label: 'Целевые пользователи' },
  { key: 'availableData', label: 'Доступные данные' },
  { key: 'constraints', label: 'Ограничения' },
  { key: 'expectedResult', label: 'Ожидаемый результат' },
  { key: 'successCriteria', label: 'Критерии успеха' },
  { key: 'contact', label: 'Контакт бизнеса' },
  { key: 'consultationFormat', label: 'Формат консультаций' },
] as const;

export type TaskFieldKey = typeof TASK_FIELDS[number]['key'];

export const READINESS_LABELS: Record<ReadinessLevel, string> = {
  draft: 'Черновик', working: 'Рабочая', ready: 'Готовая', priority: 'Приоритетная',
};

type RatingKey = Exclude<keyof RatingBreakdown, 'total' | 'potentialTotal' | 'recommendations'>;
export const RATING_CATEGORIES: { key: RatingKey; label: string; max: number }[] = [
  { key: 'contextNeed', label: 'Контекст и потребность', max: 20 },
  { key: 'data', label: 'Данные', max: 20 },
  { key: 'expectedResult', label: 'Ожидаемый результат', max: 15 },
  { key: 'successCriteria', label: 'Критерии успеха', max: 15 },
  { key: 'constraints', label: 'Ограничения', max: 10 },
  { key: 'users', label: 'Пользователи', max: 10 },
  { key: 'businessCommunication', label: 'Коммуникация с бизнесом', max: 10 },
];

export const MILESTONE_TEMPLATES = [
  { title: 'Kickoff', description: 'Бизнес и команда согласовали объём работ, данные и критерии приёмки.', points: 5 },
  { title: 'Prototype', description: 'Команда представила работающий прототип решения.', points: 10 },
  { title: 'Validation', description: 'Результат проверен на согласованных данных и сценариях.', points: 15 },
  { title: 'Final result', description: 'Бизнес принял результат, документацию и материалы проекта.', points: 20 },
] as const;
