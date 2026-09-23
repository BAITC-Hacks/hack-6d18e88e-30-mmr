import type { AiDraftAnalysis } from '../types/ai';

export async function analyzeDraft(
  draft: string,
  industry: string
): Promise<AiDraftAnalysis> {
  const response = await fetch('http://localhost:8000/api/ai/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draft,
      industry,
    }),
  });

  if (!response.ok) {
    throw new Error('AI analysis failed');
  }

  return response.json();
}
