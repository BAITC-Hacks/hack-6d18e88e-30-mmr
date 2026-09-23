import type { Task } from '../types/task';
import type { RatingBreakdown } from '../types/rating';

export function calculateRating(_task: Task): RatingBreakdown {
  throw new Error('Not implemented');
}
