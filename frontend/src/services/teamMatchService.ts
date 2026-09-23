import type { Task } from '../types/task';
import type { Team } from '../types/team';

export interface TeamMatchResult {
  total: number;
  technologies: number;
  skills: number;
  interests: number;
  industry: number;
}

export function calculateTeamMatch(_task: Task, _team: Team): TeamMatchResult {
  throw new Error('Not implemented');
}
