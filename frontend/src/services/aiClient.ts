import type {
  AiDraftAnalysis,
  ClarificationQuestion,
  ExtractedField,
  GenerateCardPayload,
  PromptInspectorData,
} from '../types/ai';
import type { Task } from '../types/task';
import { calculateRating, getReadinessLevel } from './ratingService';

const BACKEND_URL = 'http://localhost:8000';

/**
 * Local deterministic NLP analyzer for draft completeness.
 * Strictly adheres to HackAlem AI Rule 5: Never invents facts not mentioned in text.
 */
function localAnalyzeDraft(draft: string, _industry = ''): AiDraftAnalysis {
  const text = (draft || '').trim();
  const lower = text.toLowerCase();

  const detectedFields: Record<string, ExtractedField | null> = {};
  const missingFields: string[] = [];
  const questions: ClarificationQuestion[] = [];

  // 1. Title
  const firstSentence = text.split(/[.\n!?]/)[0]?.trim();
  if (firstSentence && firstSentence.length > 5) {
    detectedFields['title'] = {
      value: firstSentence.length > 60 ? firstSentence.slice(0, 60) + '...' : firstSentence,
      source: 'draft',
      confidence: 0.9,
    };
  } else {
    missingFields.push('title');
  }

  // 2. Context & Need
  if (lower.includes('сейчас') || lower.includes('проблем') || lower.includes('тер') || lower.includes('вручную') || lower.includes('занимает') || text.length > 40) {
    detectedFields['context'] = {
      value: text,
      source: 'draft',
      confidence: 0.8,
    };
  } else {
    missingFields.push('context');
    questions.push({
      id: 'q-context',
      field: 'context',
      question: 'Опишите текущий рабочий процесс: как задача решается сейчас и с какими трудностями сталкивается бизнес?',
      reason: 'Необходимо зафиксировать исходную точку и боль бизнеса для начисления до 20 баллов рейтинга.',
    });
  }

  if (lower.includes('нужен') || lower.includes('хотим') || lower.includes('сделайте') || lower.includes('разработа') || lower.includes('автоматиз')) {
    detectedFields['need'] = {
      value: text,
      source: 'draft',
      confidence: 0.85,
    };
  } else {
    missingFields.push('need');
    questions.push({
      id: 'q-need',
      field: 'need',
      question: 'Какую главную потребность бизнеса должна закрыть студенческая команда?',
    });
  }

  // 3. Target Users
  const userMatch = lower.match(/(клиент|пользовател|сотрудник|тренер|оператор|инженер|водител|администратор|студент|менеджер)[а-я]*/i);
  if (userMatch) {
    detectedFields['targetUsers'] = {
      value: `Целевая аудитория: ${userMatch[0]}`,
      source: 'draft',
      confidence: 0.75,
    };
  } else {
    missingFields.push('targetUsers');
    questions.push({
      id: 'q-users',
      field: 'targetUsers',
      question: 'Для кого создается решение: кто конкретно будет конечным пользователем продукта?',
    });
  }

  // 4. Data & Materials
  const dataMatch = lower.match(/(данны|датасет|csv|json|api|баз|таблиц|лог|выгрузк|фото|видео|снимок)[а-я]*/i);
  if (dataMatch) {
    detectedFields['availableData'] = {
      value: `Упомянуты данные: ${dataMatch[0]}`,
      source: 'draft',
      confidence: 0.8,
    };
  } else {
    missingFields.push('availableData');
    questions.push({
      id: 'q-data',
      field: 'availableData',
      question: 'Какие данные, материалы, примеры файлов или тестовые доступы вы сможете предоставить команде?',
      reason: 'Данные весят 20 баллов в шкале рейтинга готовности задачи.',
    });
  }

  // 5. Constraints
  const constrMatch = lower.match(/(срок|дедлайн|недел|месяц|python|react|docker|1с|ios|android|ограничен)[а-я0-9]*/i);
  if (constrMatch) {
    detectedFields['constraints'] = {
      value: `Зафиксированы границы/сроки: ${constrMatch[0]}`,
      source: 'draft',
      confidence: 0.7,
    };
  } else {
    missingFields.push('constraints');
    questions.push({
      id: 'q-constraints',
      field: 'constraints',
      question: 'Есть ли жесткие ограничения по срокам сдачи, стеку технологий или формату развертывания?',
    });
  }

  // 6. Expected Result
  const resultMatch = lower.match(/(результат|бот|приложени|сервис|дашборд|модел|система|сайт|прототип)[а-я]*/i);
  if (resultMatch) {
    detectedFields['expectedResult'] = {
      value: `Ожидаемый артефакт: ${resultMatch[0]}`,
      source: 'draft',
      confidence: 0.8,
    };
  } else {
    missingFields.push('expectedResult');
    questions.push({
      id: 'q-result',
      field: 'expectedResult',
      question: 'Какой конкретный результат (MVP, код в GitHub, отчет, прототип) должна сдать команда на финале?',
    });
  }

  // 7. Success Criteria
  const successMatch = lower.match(/(точност|метрик|f1|время|секунд|%|процент|конверси|сокращени)[а-я0-9]*/i);
  if (successMatch) {
    detectedFields['successCriteria'] = {
      value: `Критерий приемки: ${successMatch[0]}`,
      source: 'draft',
      confidence: 0.7,
    };
  } else {
    missingFields.push('successCriteria');
    questions.push({
      id: 'q-success',
      field: 'successCriteria',
      question: 'По каким измеримым критериям (KPI, скорость, точность) вы примете работу и поймете, что проект успешен?',
    });
  }

  // 8. Contact & Communication
  const contactMatch = text.match(/(@[a-zA-Z0-9_]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\+?[0-9]{10,})/);
  if (contactMatch) {
    detectedFields['contact'] = {
      value: contactMatch[0],
      source: 'draft',
      confidence: 0.95,
    };
  } else {
    missingFields.push('contact');
    questions.push({
      id: 'q-contact',
      field: 'contact',
      question: 'Укажите контактное лицо (Telegram / Email / телефон) и удобный формат связи для консультаций.',
    });
  }

  // Guarantee minimum 3 questions as required by HackAlem AI case Section 2
  if (questions.length < 3) {
    if (!questions.some((q) => q.field === 'consultationFormat')) {
      questions.push({
        id: 'q-format',
        field: 'consultationFormat',
        question: 'В каком формате планируется взаимодействие с командой (еженедельные созвоны, чат, ревью кода)?',
      });
    }
    if (!questions.some((q) => q.field === 'constraints')) {
      questions.push({
        id: 'q-constraints-extra',
        field: 'constraints',
        question: 'Уточните технические ограничения или предпочтительный стек технологий.',
      });
    }
  }

  return {
    detectedFields,
    missingFields,
    questions: questions.slice(0, 4), // provide top 3-4 relevant questions
    provider: 'local-heuristic-engine',
    fallbackUsed: true,
  };
}

/**
 * Analyzes a business draft description.
 * First tries backend API, falls back gracefully to local engine if server is unreachable.
 */
export async function analyzeDraft(draft: string, industry = ''): Promise<AiDraftAnalysis> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`${BACKEND_URL}/api/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft, industry }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && data.questions && data.questions.length >= 3) {
        return data;
      }
    }
  } catch {
    // Network or timeout, fallback gracefully
  }

  return localAnalyzeDraft(draft, industry);
}

/**
 * Combines initial draft and answers to clarification questions into a complete Task card.
 */
export async function generateCardFromAnswers(payload: GenerateCardPayload): Promise<Partial<Task>> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`${BACKEND_URL}/api/ai/generate-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      return response.json();
    }
  } catch {
    // Fallback to local synthesis
  }

  // Local synthesis: map answers to card fields directly without inventing facts
  const card: Partial<Task> = {
    id: `task-${Date.now()}`,
    title: payload.draft.slice(0, 60).trim(),
    industry: payload.industry || 'IT & Digital',
    tags: [payload.industry || 'Digital', 'MVP', 'AI-Sana'].filter(Boolean),
    context: payload.draft,
    need: payload.draft,
    targetUsers: '',
    availableData: '',
    constraints: '',
    expectedResult: '',
    successCriteria: '',
    contact: '',
    consultationFormat: 'Онлайн синхроны раз в неделю + чат',
    confirmedFields: ['title', 'context', 'need'],
    confirmed: false,
    published: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (const ans of payload.answers) {
    const field = ans.field as keyof Task;
    if (field && ans.answer?.trim()) {
      (card as Record<string, unknown>)[field] = ans.answer.trim();
      card.confirmedFields?.push(field);
    }
  }

  const ratingResult = calculateRating(card as Task);
  card.rating = ratingResult.total;
  card.readinessLevel = getReadinessLevel(ratingResult.total);

  return card;
}

/**
 * Returns structured Prompt Inspector data for hackathon judges review.
 */
export async function getPromptInspectorData(): Promise<PromptInspectorData> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/ai/inspector`);
    if (res.ok) {
      return res.json();
    }
  } catch {
    // Return static spec
  }

  return {
    systemPrompt: `You are an AI Business Analyst for the HackAlem AI Sana platform.
Your task is to analyze raw business needs and generate exactly 3-4 structured clarification questions.
CRITICAL RULES (HACKALEM AI REGULATION):
1. ZERO HALLUCINATIONS: Do not invent facts, metrics, or technologies that the business did not provide.
2. STRICT JSON: Respond ONLY with valid JSON matching the exact schema.
3. CONSTRUCTIVE: Focus questions on the 7 criteria that boost task rating (Data, Criteria, Deliverable, Constraints).`,
    analysisPromptTemplate: `Draft text: {draft}
Industry: {industry}
Analyze missing fields and generate questions for fields with score < maximum weight.`,
    cardGenerationPromptTemplate: `Draft: {draft}
Business Answers: {answers}
Convert into structured 9-field card without altering user facts.`,
    inputJsonSchema: {
      type: 'object',
      properties: {
        draft: { type: 'string', minLength: 10 },
        industry: { type: 'string' },
      },
      required: ['draft'],
    },
    outputJsonSchema: {
      type: 'object',
      properties: {
        detectedFields: { type: 'object' },
        missingFields: { type: 'array', items: { type: 'string' } },
        questions: {
          type: 'array',
          minItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              field: { type: 'string' },
              question: { type: 'string' },
            },
            required: ['id', 'field', 'question'],
          },
        },
        provider: { type: 'string' },
        fallbackUsed: { type: 'boolean' },
      },
      required: ['detectedFields', 'missingFields', 'questions', 'provider'],
    },
    safetyRules: [
      'Никаких выдуманных фактов или данных (Section 5 кейса).',
      'API-ключи и персональные данные изолированы в .env и никогда не отправляются на клиент.',
      'Ручное подтверждение человеком: сгенерированная карточка обязана быть подтверждена пользователем перед публикацией.',
    ],
    errorHandlingStrategy: 'Двойной защитный контур: Backend LLM -> Регекс-санитайзер JSON (_json_from_text) -> Автономный локальный NLP-движок при сетевых ошибках или таймауте.',
  };
}
