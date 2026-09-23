import { z } from 'zod';

// Only business content may be supplied by AI or clarification answers.
export const cardFields = [
  'title', 'context', 'need', 'targetUsers', 'availableData', 'constraints',
  'expectedResult', 'successCriteria', 'contact', 'consultationFormat',
] as const;
export type CardField = typeof cardFields[number];
export const cardFieldSchema = z.enum(cardFields);
const nonempty = z.string().trim().min(1);
function isSafeText(value: string): boolean {
  // for...of combines valid surrogate pairs; unpaired halves remain in this range.
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code >= 0xd800 && code <= 0xdfff) || (code < 32 && ![9, 10, 13].includes(code))) return false;
  }
  return true;
}
const safeText = z.string().refine(isSafeText, 'Некорректные символы в тексте.');

export const analyzeRequestSchema = z.strictObject({
  draft: safeText.trim().min(5).max(20000),
  industry: safeText.trim().max(200),
});
export const generateRequestSchema = analyzeRequestSchema.extend({
  answers: z.array(z.strictObject({
    questionId: safeText.trim().min(1).max(200),
    field: cardFieldSchema,
    answer: safeText.trim().max(10000),
  })).max(30),
}).refine(value => value.draft.length + value.industry.length +
  value.answers.reduce((total, answer) => total + answer.answer.length, 0) <= 50000,
  'Общий объём текста не должен превышать 50 000 символов.');

export const analysisSchema = z.strictObject({
  detectedFields: z.partialRecord(cardFieldSchema, z.strictObject({
    value: safeText.trim().min(1).max(20000),
    source: z.enum(['draft', 'clarification', 'manual']),
    confidence: z.number().min(0).max(1).nullable().optional(),
  }).nullable()),
  missingFields: z.array(cardFieldSchema).max(10),
  questions: z.array(z.strictObject({
    id: nonempty.max(200),
    field: cardFieldSchema,
    question: nonempty.max(1000),
    reason: z.string().max(1000).nullable().optional(),
  })).min(3).max(4),
  provider: nonempty.max(100),
  fallbackUsed: z.boolean(),
}).superRefine((value, ctx) => {
  if (new Set(value.missingFields).size !== value.missingFields.length ||
      value.missingFields.some(field => value.detectedFields[field] != null)) {
    ctx.addIssue({ code: 'custom', message: 'Detected and missing fields must be consistent.' });
  }
  if (new Set(value.questions.map(q => q.id)).size !== value.questions.length ||
      new Set(value.questions.map(q => q.field)).size !== value.questions.length) {
    ctx.addIssue({ code: 'custom', message: 'Clarification questions must be unique.' });
  }
});

export const generatedCardSchema = z.strictObject({
  id: nonempty.optional(),
  title: z.string(),
  industry: z.string(),
  tags: z.array(z.string()),
  context: z.string(),
  need: z.string(),
  targetUsers: z.string(),
  availableData: z.string(),
  constraints: z.string(),
  expectedResult: z.string(),
  successCriteria: z.string(),
  contact: z.string(),
  consultationFormat: z.string(),
  confirmedFields: z.array(cardFieldSchema).length(0),
  confirmed: z.literal(false),
  published: z.literal(false),
  rating: z.literal(0).optional(),
  readinessLevel: z.literal('draft').optional(),
  createdAt: nonempty.optional(),
  updatedAt: nonempty.optional(),
});

export const inspectorSchema = z.strictObject({
  systemPrompt: nonempty,
  analysisPromptTemplate: nonempty,
  cardGenerationPromptTemplate: nonempty,
  inputJsonSchema: z.record(z.string(), z.unknown()),
  outputJsonSchema: z.record(z.string(), z.unknown()),
  safetyRules: z.array(nonempty).min(1),
  errorHandlingStrategy: nonempty,
});
