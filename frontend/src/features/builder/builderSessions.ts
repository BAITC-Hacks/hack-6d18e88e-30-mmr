import type { AiDraftAnalysis } from '../../types/ai';

interface BuilderSession {
  stage: number;
  analysis: AiDraftAnalysis | null;
  exampleAnswers: boolean;
  rawDraft?: string;
  industry?: string;
}
export const sessions = new Map<string, BuilderSession>();
export function resetBuilderSessions() { sessions.clear(); }
