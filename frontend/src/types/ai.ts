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
}
