import type { AiDraftAnalysis } from '../../types/ai';

interface BuilderSession { stage: number; analysis: AiDraftAnalysis | null; exampleAnswers: boolean }
export const sessions = new Map<string, BuilderSession>();
export function resetBuilderSessions() { sessions.clear(); }
