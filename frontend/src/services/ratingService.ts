import type { Task, ReadinessLevel } from '../types/task';
import type { RatingBreakdown, RatingRecommendation } from '../types/rating';

/**
 * Validates whether a text field has substantive content (not empty, not trivial placeholders).
 * Evaluates length and informative depth.
 */
function evaluateFieldQuality(value?: string, minChars = 35): number {
  if (!value) return 0;
  const cleaned = value.trim();
  if (cleaned.length < 5) return 0;
  if (cleaned.length < 20) return 0.4;
  if (cleaned.length < minChars) return 0.75;
  return 1.0;
}

/**
 * Calculates task readiness level based on hackathon score boundaries:
 * 0–39: draft
 * 40–69: working
 * 70–89: ready
 * 90–100: priority
 */
export function getReadinessLevel(score: number): ReadinessLevel {
  if (score >= 90) return 'priority';
  if (score >= 70) return 'ready';
  if (score >= 40) return 'working';
  return 'draft';
}

/**
 * Evaluates the task readiness rating according to HackAlem AI criteria (0-100 pts):
 * CRITICAL RULE (Section 4): "Баллы начисляются только за заполненные и подтверждённые поля".
 * 
 * Weights:
 * - Context & Need: 20 pts
 * - Data & Materials: 20 pts
 * - Expected Result: 15 pts
 * - Success Criteria: 15 pts
 * - Constraints: 10 pts
 * - Target Users: 10 pts
 * - Business Communication: 10 pts
 */
export function calculateRating(task: Task): RatingBreakdown {
  const recommendations: RatingRecommendation[] = [];
  const confirmed = new Set(task.confirmedFields || []);

  // Helper: check if field is confirmed
  const isConfirmed = (fieldName: string) => confirmed.has(fieldName);

  // 1. Context & Need (20 pts: 10 for context, 10 for need)
  const hasContext = isConfirmed('context');
  const hasNeed = isConfirmed('need');
  const contextQ = hasContext ? evaluateFieldQuality(task.context, 45) : 0;
  const needQ = hasNeed ? evaluateFieldQuality(task.need, 40) : 0;
  const contextNeed = Math.round(contextQ * 10 + needQ * 10);
  if (contextNeed < 20) {
    recommendations.push({
      field: 'context',
      message: 'Подробнее опишите текущее состояние процессов и подтвердите проблему бизнеса',
      possibleGain: 20 - contextNeed,
    });
  }

  // 2. Data & Materials (20 pts)
  const hasData = isConfirmed('availableData');
  const dataQ = hasData ? evaluateFieldQuality(task.availableData, 45) : 0;
  const data = Math.round(dataQ * 20);
  if (data < 20) {
    recommendations.push({
      field: 'availableData',
      message: 'Укажите доступные данные, форматы файлов (CSV/JSON/API), примеры или доступы (+20 б.)',
      possibleGain: 20 - data,
    });
  }

  // 3. Expected Result (15 pts)
  const hasResult = isConfirmed('expectedResult');
  const resultQ = hasResult ? evaluateFieldQuality(task.expectedResult, 35) : 0;
  const expectedResult = Math.round(resultQ * 15);
  if (expectedResult < 15) {
    recommendations.push({
      field: 'expectedResult',
      message: 'Зафиксируйте конкретный артефакт сдачи (MVP, репозиторий в GitHub, документация) (+15 б.)',
      possibleGain: 15 - expectedResult,
    });
  }

  // 4. Success Criteria (15 pts)
  const hasSuccess = isConfirmed('successCriteria');
  const successQ = hasSuccess ? evaluateFieldQuality(task.successCriteria, 35) : 0;
  const successCriteria = Math.round(successQ * 15);
  if (successCriteria < 15) {
    recommendations.push({
      field: 'successCriteria',
      message: 'Задайте измеримые критерии приемки решения (точность, метрики F1, SLA, скорость) (+15 б.)',
      possibleGain: 15 - successCriteria,
    });
  }

  // 5. Constraints (10 pts)
  const hasConstraints = isConfirmed('constraints');
  const constraintsQ = hasConstraints ? evaluateFieldQuality(task.constraints, 25) : 0;
  const constraints = Math.round(constraintsQ * 10);
  if (constraints < 10) {
    recommendations.push({
      field: 'constraints',
      message: 'Укажите дедлайны, требуемый стек технологий или ограничения доступа (+10 б.)',
      possibleGain: 10 - constraints,
    });
  }

  // 6. Target Users (10 pts)
  const hasUsers = isConfirmed('targetUsers');
  const usersQ = hasUsers ? evaluateFieldQuality(task.targetUsers, 25) : 0;
  const users = Math.round(usersQ * 10);
  if (users < 10) {
    recommendations.push({
      field: 'targetUsers',
      message: 'Опишите целевую аудиторию и сценарии использования (+10 б.)',
      possibleGain: 10 - users,
    });
  }

  // 7. Business Communication & Contacts (10 pts: 5 contact, 5 format)
  const hasContact = isConfirmed('contact');
  const hasFormat = isConfirmed('consultationFormat');
  const contactQ = hasContact ? evaluateFieldQuality(task.contact, 10) : 0;
  const formatQ = hasFormat ? evaluateFieldQuality(task.consultationFormat, 20) : 0;
  const businessCommunication = Math.round(contactQ * 5 + formatQ * 5);
  if (businessCommunication < 10) {
    recommendations.push({
      field: 'contact',
      message: 'Укажите контакты куратора и подтвердите регулярный формат консультаций (+10 б.)',
      possibleGain: 10 - businessCommunication,
    });
  }

  const total = contextNeed + data + expectedResult + successCriteria + constraints + users + businessCommunication;
  const potentialTotal = 100;

  // Sort recommendations by highest possible gain first
  recommendations.sort((a, b) => b.possibleGain - a.possibleGain);

  return {
    contextNeed,
    data,
    expectedResult,
    successCriteria,
    constraints,
    users,
    businessCommunication,
    total,
    potentialTotal,
    recommendations,
  };
}
