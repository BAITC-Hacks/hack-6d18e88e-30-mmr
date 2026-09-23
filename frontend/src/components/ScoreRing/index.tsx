export function ScoreRing({ score, size = 100 }: { score: number; size?: number }) {
  const normalized = Math.max(0,Math.min(100,score));
  return <span className="score-ring" style={{width:size,height:size}} role="img" aria-label={`Готовность ${normalized} из 100`}><svg width={size} height={size} viewBox="0 0 100 100"><circle cx="50" cy="50" r="43" fill="none" stroke="#e6ecdf" strokeWidth="6" /><circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray="270.18" strokeDashoffset={270.18*(1-normalized/100)} /></svg><span className="score-ring-label"><strong style={size < 80 ? {fontSize:22}:undefined}>{normalized}</strong><small>/ 100</small></span></span>;
}
