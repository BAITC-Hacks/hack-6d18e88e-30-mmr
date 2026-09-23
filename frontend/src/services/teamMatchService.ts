import type { Task } from '../types/task';
import type { Team } from '../types/team';

export interface TeamMatchResult {
  total: number;
  technologies: number;
  skills: number;
  interests: number;
  industry: number;
  matchedTags: string[];
}

/** Keep word boundaries and C++/C#; normalize both the task and profile labels. */
function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, '')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
}

function containsLabel(text: string, label: string): boolean {
  return label.length > 0 && ` ${text} `.includes(` ${label} `);
}

function uniqueLabels(labels: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const label of labels) {
    const normalized = normalize(label);
    if (normalized && !result.has(normalized)) result.set(normalized, label.trim());
  }
  return result;
}

/**
 * Explainable profile relevance (0–100), independent of progress points and
 * task readiness. It never selects teams or restricts access to published tasks.
 */
export function calculateTeamMatch(task: Task, team: Team): TeamMatchResult {
  const taskText = normalize([
    task.title, task.industry, ...task.tags, task.context, task.need,
    task.targetUsers, task.availableData, task.constraints, task.expectedResult,
  ].join(' '));
  const matched = new Map<string, string>();

  const scoreLabels = (labels: string[], targetMatches: number): number => {
    const unique = uniqueLabels(labels);
    if (unique.size === 0) return 0;
    let count = 0;
    for (const [normalized, label] of unique) {
      if (containsLabel(taskText, normalized)) {
        count++;
        if (!matched.has(normalized)) matched.set(normalized, label);
      }
    }
    return Math.min(100, Math.round(count / Math.min(unique.size, targetMatches) * 100));
  };

  const technologies = scoreLabels(team.technologies, 4);
  const skills = scoreLabels(team.skills, 3);
  const interests = scoreLabels(team.interests, 3);
  const taskIndustry = normalize(task.industry);
  let industry = 0;
  for (const [normalized, label] of uniqueLabels(team.industries)) {
    if (containsLabel(taskIndustry, normalized)) {
      industry = 100;
      if (!matched.has(normalized)) matched.set(normalized, label);
    }
  }

  const total = Math.round(technologies * 0.35 + skills * 0.25 + interests * 0.20 + industry * 0.20);
  return { total, technologies, skills, interests, industry, matchedTags: [...matched.values()] };
}

/** Returns every published task, including low readiness and low relevance. */
export function getRecommendedTasksForTeam(team: Team, tasks: Task[]): { task: Task; match: TeamMatchResult }[] {
  return tasks
    .filter((task) => task.published)
    .map((task) => ({ task, match: calculateTeamMatch(task, team) }))
    .sort((a, b) => b.match.total - a.match.total || b.task.rating - a.task.rating || a.task.id.localeCompare(b.task.id));
}
