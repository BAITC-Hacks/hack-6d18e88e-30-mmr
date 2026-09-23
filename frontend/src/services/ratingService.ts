import type { Task, ReadinessLevel } from '../types/task';
import type { RatingBreakdown, RatingRecommendation } from '../types/rating';

type RatingField = 'context' | 'need' | 'availableData' | 'expectedResult'
  | 'successCriteria' | 'constraints' | 'targetUsers' | 'contact' | 'consultationFormat';
type RatingCategory = Exclude<keyof RatingBreakdown, 'total' | 'potentialTotal' | 'recommendations'>;

const criteria: {
  field: RatingField;
  category: RatingCategory;
  weight: number;
  minChars: number;
  instruction: string;
}[] = [
  { field: 'context', category: 'contextNeed', weight: 10, minChars: 45, instruction: 'Опишите текущее состояние процессов' },
  { field: 'need', category: 'contextNeed', weight: 10, minChars: 40, instruction: 'Опишите проблему бизнеса и необходимое изменение' },
  { field: 'availableData', category: 'data', weight: 20, minChars: 45, instruction: 'Укажите доступные данные, форматы и примеры или источники' },
  { field: 'expectedResult', category: 'expectedResult', weight: 15, minChars: 35, instruction: 'Опишите конкретный результат работы команды: MVP, сервис или документацию' },
  { field: 'successCriteria', category: 'successCriteria', weight: 15, minChars: 35, instruction: 'Задайте измеримые критерии приемки решения' },
  { field: 'constraints', category: 'constraints', weight: 10, minChars: 25, instruction: 'Укажите сроки, технологии и ограничения доступа' },
  { field: 'targetUsers', category: 'users', weight: 10, minChars: 25, instruction: 'Опишите пользователей и сценарии использования' },
  { field: 'contact', category: 'businessCommunication', weight: 5, minChars: 10, instruction: 'Укажите контакт куратора задачи' },
  { field: 'consultationFormat', category: 'businessCommunication', weight: 5, minChars: 20, instruction: 'Опишите формат консультаций и порядок обратной связи' },
];

/** A transparent completeness heuristic, not a semantic assessment of the text. */
function evaluateFieldQuality(value: string, minChars: number): number {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  const marker = cleaned.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (/^(?:нет|позже|уточняется|тест|test)$/u.test(marker)) return 0;
  if (!marker || /^(?:не указан[оыа]?|не определен[оыа]?|не заполнен[оыа]?|неизвестно|нет данных|не знаю|требует уточнения|требуют уточнения|требуется уточнение|нужно уточнить|уточнить|будет уточнено|пока неизвестно|unknown|not specified|not provided|to be determined|tbd|todo|n a)(?:\s|$)/u.test(marker)) {
    return 0;
  }
  if (cleaned.length < 5) return 0;
  // Short, usable contacts should not need padding to receive their full weight.
  if (cleaned.length >= minChars) return 1;
  if (cleaned.length < 20) return 0.4;
  return 0.75;
}

/** Hackathon readiness boundaries: 0–39, 40–69, 70–89 and 90–100. */
export function getReadinessLevel(score: number): ReadinessLevel {
  if (score >= 90) return 'priority';
  if (score >= 70) return 'ready';
  if (score >= 40) return 'working';
  return 'draft';
}

/**
 * Only filled, confirmed fields earn actual points (20/20/15/15/10/10/10).
 * Potential points show what confirming the current text would earn; they do
 * not assume that missing information will be supplied. Recommendations show
 * the gain from completing and confirming one specific field to its full weight.
 */
export function calculateRating(task: Task): RatingBreakdown {
  const confirmed = new Set(task.confirmedFields || []);
  const recommendations: RatingRecommendation[] = [];
  const breakdown: RatingBreakdown = {
    contextNeed: 0,
    data: 0,
    expectedResult: 0,
    successCriteria: 0,
    constraints: 0,
    users: 0,
    businessCommunication: 0,
    total: 0,
    potentialTotal: 0,
    recommendations,
  };

  for (const { field, category, weight, minChars, instruction } of criteria) {
    const potentialPoints = Math.round(evaluateFieldQuality(task[field], minChars) * weight);
    const points = confirmed.has(field) ? potentialPoints : 0;
    breakdown[category] += points;
    breakdown.total += points;
    breakdown.potentialTotal += potentialPoints;

    if (points < weight) {
      const possibleGain = weight - points;
      const action = potentialPoints === weight
        ? `${instruction}: проверьте и подтвердите заполненное поле`
        : `${instruction} и подтвердите поле`;
      recommendations.push({ field, message: `${action} (+${possibleGain} б.)`, possibleGain });
    }
  }

  recommendations.sort((a, b) => b.possibleGain - a.possibleGain);
  return breakdown;
}
