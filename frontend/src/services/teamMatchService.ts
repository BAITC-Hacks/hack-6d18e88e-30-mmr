import type { Task } from '../types/task';
import type { Team } from '../types/team';
import { seedTeams } from '../data/syntheticData';

export interface TeamMatchResult {
  total: number;
  technologies: number;
  skills: number;
  interests: number;
  industry: number;
  matchedTags: string[];
  /** UI-compatible alias of the actual matched profile labels. */
  matching: string[];
  /** Explicit task tags/industry absent from the team's stated capabilities. */
  missing: string[];
}

/** Keep word boundaries and C++/C#; normalize both the task and profile labels. */
function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
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

// The demo's vocabulary identifies requirements independently of how many
// unrelated capabilities a candidate lists. Custom labels remain supported.
const vocabulary = {
  technologies: seedTeams.flatMap(team => team.technologies),
  skills: seedTeams.flatMap(team => team.skills),
  interests: seedTeams.flatMap(team => team.interests),
};

/** Replace longest names first so React Native does not also require React. */
function markLabels(text: string, labels: string[]) {
  const mentioned = new Set<string>();
  let marked = text;
  for (const [index, label] of labels.entries()) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    marked = marked.replace(new RegExp(`(?<!\\S)${escaped}(?!\\S)`, 'gu'), () => {
      mentioned.add(label);
      return `§${index}§`;
    });
  }
  return { marked, mentioned };
}

// A deliberately small grammar for explicit bans, including comma/conjunction
// lists. Words outside the label list end the scope; this is not general NLP.
const listItem = String.raw`(?:§\d+§|[\p{L}\p{N}+#]+)`;
const conjunction = String.raw`(?:и|или|and|or|және|мен|немесе)`;
const labelList = `${listItem}(?:(?:\\s*,\\s*(?:${conjunction}\\s+)?|\\s+${conjunction}\\s+)${listItem})*`;
const prefixBan = new RegExp(String.raw`(?<!\S)(?<!не )(?<!not )(?<!нельзя )(?<!запрещено )(?:не использовать|не применять|без(?: использования)?|запрещено(?: использовать| применение)?|нельзя использовать|не допускается(?: использовать| использование)?|do not use|must not use|never use|forbidden to use|prohibited to use|without|no)\s+(${labelList})(?!\S)`, 'gu');
const postfixBan = new RegExp(String.raw`(?<!\S)(${labelList})\s+(?:не использовать|не применять|(?:использовать|применять) нельзя|запрещен[аоы]?|(?:is|are) (?:not allowed|forbidden|prohibited)|must not be used|қолдануға болмайды|пайдалануға болмайды)(?!\S)`, 'gu');

function forbiddenLabels(constraints: string, labels: string[]): Set<string> {
  const forbidden = new Set<string>();
  for (const clause of constraints.split(/[;!?\n]|\.(?=\s|$)/u)) {
    // Preserve comma separators so an unlisted name (e.g. Excel) before React
    // does not prevent recognizing the rest of an explicit prohibition list.
    const { marked } = markLabels(clause.split(',').map(normalize).join(' , '), labels);
    for (const pattern of [prefixBan, postfixBan]) {
      for (const match of marked.matchAll(pattern)) {
        for (const marker of match[1].matchAll(/§(\d+)§/g)) forbidden.add(labels[Number(marker[1])]);
      }
    }
  }
  return forbidden;
}

/**
 * Explainable profile relevance (0–100), independent of progress points and
 * task readiness. It never selects teams or restricts access to published tasks.
 */
export function calculateTeamMatch(task: Task, team: Team): TeamMatchResult {
  const knownLabels = [...uniqueLabels([
    ...vocabulary.technologies, ...vocabulary.skills, ...vocabulary.interests,
    ...team.technologies, ...team.skills, ...team.interests, ...task.tags,
  ]).keys()].sort((a, b) => b.length - a.length);
  const taskText = [
    task.title, task.industry, ...task.tags, task.context, task.need,
    task.targetUsers, task.availableData, task.constraints, task.expectedResult,
  ].map(normalize).join('\n');
  const { mentioned } = markLabels(taskText, knownLabels);
  const forbidden = forbiddenLabels(task.constraints, knownLabels);
  const matched = new Map<string, string>();

  const scoreLabels = (labels: string[], known: string[], targetMatches: number): number => {
    const unique = uniqueLabels(labels);
    if (unique.size === 0) return 0;
    const requirements = new Set([...uniqueLabels([...known, ...labels]).keys()]
      .filter(label => mentioned.has(label) && !forbidden.has(label)));
    if (requirements.size === 0) return 0;
    let count = 0;
    for (const [normalized, label] of unique) {
      if (requirements.has(normalized)) {
        count++;
        if (!matched.has(normalized)) matched.set(normalized, label);
      }
    }
    return Math.min(100, Math.round(count / Math.min(requirements.size, targetMatches) * 100));
  };

  const technologies = scoreLabels(team.technologies, vocabulary.technologies, 4);
  const skills = scoreLabels(team.skills, vocabulary.skills, 3);
  const interests = scoreLabels(team.interests, vocabulary.interests, 3);
  const taskIndustry = normalize(task.industry);
  let industry = 0;
  for (const [normalized, label] of uniqueLabels(team.industries)) {
    if (containsLabel(taskIndustry, normalized)) {
      industry = 100;
      if (!matched.has(normalized)) matched.set(normalized, label);
    }
  }

  const total = Math.round(technologies * 0.35 + skills * 0.25 + interests * 0.20 + industry * 0.20);
  const capabilities = uniqueLabels([...team.technologies, ...team.skills, ...team.interests, ...team.industries]);
  const missing = uniqueLabels(task.tags.filter(tag => !capabilities.has(normalize(tag)) && !forbidden.has(normalize(tag))));
  if (industry) missing.delete(taskIndustry);
  if (taskIndustry && !industry && !capabilities.has(taskIndustry)) {
    missing.set(taskIndustry, task.industry.trim());
  }
  const matchedTags = [...matched.values()];
  return {
    total, technologies, skills, interests, industry, matchedTags,
    matching: [...matchedTags], missing: [...missing.values()],
  };
}

/** Returns every published task, including low readiness and low relevance. */
export function getRecommendedTasksForTeam(team: Team, tasks: Task[]): { task: Task; match: TeamMatchResult }[] {
  return tasks
    .filter((task) => task.published)
    .map((task) => ({ task, match: calculateTeamMatch(task, team) }))
    .sort((a, b) => b.match.total - a.match.total || b.task.rating - a.task.rating || a.task.id.localeCompare(b.task.id));
}
