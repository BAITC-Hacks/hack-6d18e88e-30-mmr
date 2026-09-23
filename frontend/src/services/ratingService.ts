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

const evasivePatterns = [
  /(?:обсуд(?:им|ить|яется)|реш(?:им|ить|ится)|определ(?:им|ить|ится)|вернемся|уточн(?:им|ить)|скаж(?:ем|у)|напиш(?:ем|у))\s+(?:позже|потом|со\s+временем)/u,
  /(?:конкретн(?:ой|ых)|точных|подробн(?:ой|ых))\s+(?:информаци[ией]|сведени[йи]|данных)\s+(?:у\s+нас\s+)?нет/u,
  /(?:информаци[ия]|сведени[яй]|данных)\s+(?:пока|сейчас)?\s*(?:у\s+нас\s+)?(?:нет|отсутству(?:ет|ют))/u,
  /(?:пока|сейчас|у\s+нас)?\s*(?:нет|отсутству(?:ет|ют))\s+(?:пока|сейчас|у\s+нас)?\s*(?:конкретн\w+|точн\w+)?\s*(?:информаци[ия]|сведени[яй]|данных)/u,
  /(?:на\s+этот\s+вопрос|по\s+этому\s+поводу)\s+(?:пока\s+)?нет(?:\s+конкретного)?\s+ответа/u,
  /пока\s+(?:не\s+(?:знаем|можем\s+сказать)|ничего\s+нет)/u,
];

function isEvasiveText(marker: string): boolean {
  return evasivePatterns.some(pattern => pattern.test(marker));
}

const dataSourcePattern = /(?:csv|json|api|parquet|sql|таблиц[\p{L}]*|выгрузк[\p{L}]*|лог[\p{L}]*|датасет[\p{L}]*)/iu;
const plannedCollectionPattern = /(?:планиру[\p{L}]*|буд[\p{L}]*|в\s+процессе|соберем)\s+(?:собрать|сбор[\p{L}]*|получить|накопить)/iu;

function isUnavailableData(clause: string): boolean {
  // A source followed by an explicit absence, or a refusal to provide it.
  // Keep qualifications such as "В CSV нет персональных данных" as useful facts.
  return /(?:данн[\p{L}]*|csv|json|api|parquet|sql|таблиц[\p{L}]*|выгрузк[\p{L}]*|лог[\p{L}]*)\s+(?:(?:пока|сейчас|тоже|у\s+нас)\s+)*(?:нет|отсутству[\p{L}]*|недоступн[\p{L}]*)$/iu.test(clause)
    || ((dataSourcePattern.test(clause) || /данн[\p{L}]*/iu.test(clause))
      && /(?:^|\s)не\s+(?:(?:можем|будем)\s+)?предостав[\p{L}]*/iu.test(clause));
}

/**
 * Transparent completeness and readiness heuristic.
 * Distinguishes concrete facts/metrics from evasive, deferred, or placeholder answers.
 */
function evaluateFieldQuality(field: RatingField, value: string, minChars: number): number {
  let cleaned = value.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim().replace(/\s+/g, ' ');
  const marker = cleaned.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  if (/^(?:нет|позже|уточняется|тест|test)$/u.test(marker)) return 0;
  if (!marker || /^(?:не указан[оыа]?|не определен[оыа]?|не заполнен[оыа]?|неизвестно|нет данных|не знаю|требует уточнения|требуют уточнения|требуется уточнение|нужно уточнить|уточнить|будет уточнено|пока неизвестно|unknown|not specified|not provided|to be determined|tbd|todo|n a)$/u.test(marker)) {
    return 0;
  }

  // Obvious filler cannot earn points merely by crossing a character threshold.
  if (/^(?:(?:placeholder|lorem|ipsum|test|тест)\s*)+$/u.test(marker)) return 0;
  const words = marker.split(' ');
  if (words.length >= 4 && new Set(words).size === 1) return 0;
  if (/^([\p{L}]{1,12})\1{3,}$/u.test(marker.replace(/ /g, ''))) return 0;
  if (cleaned.length < 5) return 0;

  // Evaluate explicit deferrals/negations within their own clauses. An unavailable
  // source or deferred detail must not erase a separate usable fact (or vice versa).
  // Sentence dots and non-decimal commas preserve metrics, addresses and domains.
  const factualClauses = cleaned.split(/[;!?]|\.(?=\s|$)|,(?!\d)|\s+(?:но|однако)\s+/iu)
    .map(clause => clause.trim())
    .filter(clause => clause && !isEvasiveText(clause.toLowerCase().replace(/ё/g, 'е'))
      && !(field === 'availableData' && isUnavailableData(clause))
      && !(field === 'successCriteria' && /не\s+(?:явля[\p{L}]*|счита[\p{L}]*)\s+критери[\p{L}]*/iu.test(clause)));
  cleaned = factualClauses.join('. ');
  if (!cleaned) return 0;

  // Field-specific evaluations:
  if (field === 'availableData') {
    const hasCurrentData = factualClauses.some(clause => !plannedCollectionPattern.test(clause)
      && (dataSourcePattern.test(clause) || /(?:доступн[\p{L}]*|предоставим)/iu.test(clause)));
    if (hasCurrentData && cleaned.length >= 20) {
      return 1;
    }
    if (factualClauses.some(clause => plannedCollectionPattern.test(clause))) return 0.5;
  }

  if (field === 'successCriteria') {
    // Actionable, measurable criteria (e.g. "F1 ≥ 0.9", "точность 95%", "время ответа < 200 мс")
    // must receive full credit without forcing artificial padding.
    const hasMeasurableMetric = /(?:f1|accuracy|precision|recall|roc|auc|map|bleu|ndcg|rmse|mae|sla|fps|rps|latency|точност[\p{L}]*|время\s+ответа|списани[\p{L}]*|брак[\p{L}]*)\s*(?:(?:[≥≤><=±:]|не\s+(?:менее|более|выше|ниже)|до|от)\s*)?[+-]?\d+(?:[.,]\d+)?/iu.test(cleaned)
      || /(?:[≥≤><=±]\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*%)/u.test(cleaned);
    if (hasMeasurableMetric) {
      return 1;
    }
  }

  if (field === 'contact') {
    const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(cleaned);
    const hasTelegram = /(?:@|t\.me\/|telegram:?\s*@?)[a-zA-Z0-9_]{3,}/i.test(cleaned);
    const hasPhone = /(?:\+?7|8)[\s(-]?\d{3}[)\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(cleaned);
    const hasDetailedContact = cleaned.length >= 40;
    if (hasEmail || hasTelegram || hasPhone || hasDetailedContact) {
      return 1;
    }
    return 0.4;
  }

  if (field === 'constraints') {
    if (/нет\s+ограничений/iu.test(cleaned)) {
      return 1;
    }
  }

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
    const potentialPoints = Math.round(evaluateFieldQuality(field, task[field], minChars) * weight);
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
