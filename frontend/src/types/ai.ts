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
