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

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
}

/**
 * Calculates matching score between a task and a student team.
 * Returns breakdown in percentages (0-100).
 */
export function calculateTeamMatch(task: Task, team: Team): TeamMatchResult {
  const taskText = `${task.title} ${task.industry} ${task.tags.join(' ')} ${task.need} ${task.constraints} ${task.expectedResult}`.toLowerCase();
  const matchedTags: string[] = [];

  // 1. Technologies match (35%)
  let techMatches = 0;
  if (team.technologies.length > 0) {
    for (const tech of team.technologies) {
      const normTech = normalize(tech);
      if (normTech && taskText.includes(normTech)) {
        techMatches++;
        if (!matchedTags.includes(tech)) matchedTags.push(tech);
      }
    }
  }
  const techScore = team.technologies.length > 0 
    ? Math.min(100, Math.round((techMatches / Math.min(team.technologies.length, 4)) * 100))
    : 50;

  // 2. Skills match (25%)
  let skillMatches = 0;
  if (team.skills.length > 0) {
    for (const skill of team.skills) {
      const normSkill = normalize(skill);
      if (normSkill && taskText.includes(normSkill)) {
        skillMatches++;
        if (!matchedTags.includes(skill)) matchedTags.push(skill);
      }
    }
  }
  const skillScore = team.skills.length > 0
    ? Math.min(100, Math.round((skillMatches / Math.min(team.skills.length, 3)) * 100))
    : 50;

  // 3. Interests match (20%)
  let interestMatches = 0;
  if (team.interests.length > 0) {
    for (const interest of team.interests) {
      const normInterest = normalize(interest);
      if (normInterest && taskText.includes(normInterest)) {
        interestMatches++;
        if (!matchedTags.includes(interest)) matchedTags.push(interest);
      }
    }
  }
  const interestScore = team.interests.length > 0
    ? Math.min(100, Math.round((interestMatches / Math.min(team.interests.length, 3)) * 100))
    : 50;

  // 4. Industry match (20%)
  let industryScore = 30; // base compatibility
  const normTaskIndustry = normalize(task.industry);
  if (team.industries.some((ind) => normalize(ind) === normTaskIndustry || taskText.includes(normalize(ind)))) {
    industryScore = 100;
    matchedTags.push(task.industry);
  }

  // Weighted total (35% tech + 25% skills + 20% interests + 20% industry)
  const total = Math.round(
    techScore * 0.35 +
    skillScore * 0.25 +
    interestScore * 0.20 +
    industryScore * 0.20
  );

  return {
    total: Math.max(10, Math.min(100, total)),
    technologies: techScore,
    skills: skillScore,
    interests: interestScore,
    industry: industryScore,
    matchedTags,
  };
}

/**
 * Returns tasks sorted by compatibility for a given student team.
 */
export function getRecommendedTasksForTeam(team: Team, tasks: Task[]): { task: Task; match: TeamMatchResult }[] {
  return tasks
    .filter((task) => task.published)
    .map((task) => ({
      task,
      match: calculateTeamMatch(task, team),
    }))
    .sort((a, b) => b.match.total - a.match.total);
}
