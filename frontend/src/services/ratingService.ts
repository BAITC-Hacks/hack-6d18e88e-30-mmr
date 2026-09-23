import type { ReadinessLevel, Task } from '../types/task';
import type { RatingBreakdown, RatingRecommendation } from '../types/rating';

const emptyAnswer = /^(?:нет|не знаю|позже|уточняется|не указано|tbd|n\/a|test|тест|[-—.?]+)$/iu;
const meaningful = (value: string) => value.trim().length > 0 && !emptyAnswer.test(value.trim());

// A local, deterministic readiness rubric. It evaluates completeness, not truth.
function descriptionScore(value: string, max: number): number {
  if (!meaningful(value)) return 0;
  const words = value.trim().split(/\s+/u).length;
  if (words < 3 || value.trim().length < 14) return Math.round(max * 0.3);
  if (words < 7 || value.trim().length < 42) return Math.round(max * 0.65);
  return max;
}

const dataFormat = /\b(?:csv|xlsx?|json|sql|api|pdf|crm)\b|таблиц|выгрузк|запис|документ|датасет/iu;
const dataAccess = /доступ|передад|предостав|обезлич|выгруз|открыт|истори|месяц|недел|\d|access|anonym/iu;
const deliverable = /прототип|панел|модел|приложени|отч[её]т|сервис|бот|алгоритм|дашборд|интерфейс|систем|prototype|dashboard|app|report|model/iu;
const measurable = /\d+(?:[.,]\d+)?\s*(?:%|процент|минут|секунд|час|дн|день|дней|недел|балл|руб|₸|тенге|раз|запис|заяв|клиент|заказ|пользоват|percent|minute|second|hour)|(?:точност|accuracy|f1|mae|mape|конверси|ошибк|врем|срок|сниз|сократ|увелич|дол[яю])[^.!?]*\d/iu;
const metric = /точност|ошиб|врем|скорост|дол[яю]|конверси|сокра|сниз|увелич|эконом|пропуск|задерж|успеш|accuracy|f1|mae|mape|latency|conversion/iu;
const practicalConstraint = /срок|недел|дн[яеи]|дней|месяц|бюджет|тенге|доступ|сервер|облако|персональ|конфиденц|безопас|обезлич|интеграц|только|без |python|react|deadline|budget|privacy/iu;

export function getReadinessLevel(score: number): ReadinessLevel {
  if (score >= 90) return 'priority';
  if (score >= 70) return 'ready';
  if (score >= 40) return 'working';
  return 'draft';
}

export function calculateRating(task: Task): RatingBreakdown {
  const context = descriptionScore(task.context, 10);
  const need = descriptionScore(task.need, 10);
  const data = descriptionScore(task.availableData, 10)
    + (meaningful(task.availableData) && dataFormat.test(task.availableData) ? 5 : 0)
    + (meaningful(task.availableData) && dataAccess.test(task.availableData) ? 5 : 0);
  const expectedResult = descriptionScore(task.expectedResult, 10)
    + (meaningful(task.expectedResult) && deliverable.test(task.expectedResult) ? 5 : 0);
  const successCriteria = descriptionScore(task.successCriteria, 5)
    + (meaningful(task.successCriteria) && measurable.test(task.successCriteria) ? 5 : 0)
    + (meaningful(task.successCriteria) && metric.test(task.successCriteria) ? 5 : 0);
  const constraints = descriptionScore(task.constraints, 5)
    + (meaningful(task.constraints) && practicalConstraint.test(task.constraints) ? 5 : 0);
  const users = descriptionScore(task.targetUsers, 10);
  const contact = meaningful(task.contact)
    ? (/[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s()-]{7,}/u.test(task.contact) || task.contact.trim().length >= 12 ? 5 : 2) : 0;
  const consultation = descriptionScore(task.consultationFormat, 5);
  const businessCommunication = contact + consultation;
  const contextNeed = context + need;
  const total = contextNeed + data + expectedResult + successCriteria + constraints + users + businessCommunication;
  const recommendations: RatingRecommendation[] = [];
  const suggest = (field: string, score: number, max: number, message: string) => {
    if (score < max) recommendations.push({ field, message, possibleGain: max - score });
  };
  suggest('context', context, 10, 'Опишите текущий процесс, масштаб бизнеса и проблему на конкретном примере.');
  suggest('need', need, 10, 'Уточните, какое действие нужно улучшить и почему это важно бизнесу.');
  suggest('availableData', data, 20, 'Укажите состав и формат данных (например, CSV), объём и условия доступа.');
  suggest('expectedResult', expectedResult, 15, 'Опишите конкретный результат: прототип, панель, модель или приложение и его функции.');
  suggest('successCriteria', successCriteria, 15, 'Добавьте измеримую метрику и цель: например, сократить время обработки на 30%.');
  suggest('constraints', constraints, 10, 'Опишите сроки, бюджет, требования к безопасности или технические ограничения.');
  suggest('targetUsers', users, 10, 'Назовите пользователей, их роли и сценарий использования решения.');
  suggest('contact', contact, 5, 'Укажите ответственное лицо и рабочий контакт для связи.');
  suggest('consultationFormat', consultation, 5, 'Уточните канал, частоту и продолжительность консультаций с бизнесом.');
  recommendations.sort((a, b) => b.possibleGain - a.possibleGain);
  return {
    contextNeed, data, expectedResult, successCriteria, constraints, users, businessCommunication,
    total, potentialTotal: total + recommendations.reduce((sum, item) => sum + item.possibleGain, 0), recommendations,
  };
}
