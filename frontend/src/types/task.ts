export type ReadinessLevel = | 'draft' | 'working' | 'ready' | 'priority';

export interface Task {
  id: string;
  rawDraft?: string;
  fieldSources?: Partial<Record<string, 'draft' | 'clarification' | 'manual'>>;
  title: string;
  industry: string;
  tags: string[];
  context: string;
  need: string;
  targetUsers: string;
  availableData: string;
  constraints: string;
  expectedResult: string;
  successCriteria: string;
  contact: string;
  consultationFormat: string;
  confirmedFields: string[];
  rating: number;
  readinessLevel: ReadinessLevel;
  confirmed: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}
