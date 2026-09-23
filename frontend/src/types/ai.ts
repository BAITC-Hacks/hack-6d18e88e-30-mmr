export type FieldSource = | 'draft' | 'clarification' | 'manual';

export interface ExtractedField {
  value: string;
  source: FieldSource;
  confidence?: number;
}

export interface ClarificationQuestion {
  id: string;
  field: string;
  question: string;
  reason?: string;
}

export interface ClarificationAnswer {
  questionId: string;
  field: string;
  answer: string;
}

export interface AiDraftAnalysis {
  detectedFields: Record<string, ExtractedField | null>;
  missingFields: string[];
  questions: ClarificationQuestion[];
  provider: string;
  fallbackUsed: boolean;
  reason?: string;
}

export interface AiInspection {
  prompt: string;
  input: { draft: string; industry: string };
  outputSchema: unknown;
  response: unknown;
  normalizedResponse: AiDraftAnalysis;
  validation: { jsonValid: boolean; schemaValid: boolean; issues: string[] };
  provider: string;
  fallbackUsed: boolean;
  reason?: string;
  durationMs: number;
}

export interface GenerateCardPayload {
  draft: string;
  industry: string;
  answers: ClarificationAnswer[];
}

export interface TaskDraftSeed {
  id: string;
  title: string;
  industry: string;
  text: string;
  completeness: 'weak' | 'medium' | 'high';
  estimatedInitialScore: number;
}

export interface PromptInspectorData {
  systemPrompt: string;
  analysisPromptTemplate: string;
  cardGenerationPromptTemplate: string;
  inputJsonSchema: Record<string, unknown>;
  outputJsonSchema: Record<string, unknown>;
  safetyRules: string[];
  errorHandlingStrategy: string;
}
