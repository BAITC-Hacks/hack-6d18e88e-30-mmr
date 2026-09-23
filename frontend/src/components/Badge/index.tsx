import type { HTMLAttributes } from 'react';
import { getReadinessLevel } from '../../services/ratingService';
const labels = { draft: 'Черновик', working: 'Рабочая', ready: 'Готовая', priority: 'Приоритетная' };
export function Badge({ children, variant = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: string }) {
  return <span className={`badge badge-${variant} ${className}`} {...props}>{children}</span>;
}
export function ReadinessBadge({ score }: { score: number }) {
  const level = getReadinessLevel(score);
  return <Badge variant={level}><span aria-hidden="true">●</span> {labels[level]}</Badge>;
}
