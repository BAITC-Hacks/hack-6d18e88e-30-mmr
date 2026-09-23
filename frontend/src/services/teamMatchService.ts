import type { Task } from '../types/task';
import type { Team } from '../types/team';

export interface TeamMatchResult {
  total: number;
  technologies: number;
  skills: number;
  interests: number;
  industry: number;
  matching: string[];
  missing: string[];
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/ё/gu, 'е').replace(/[\s._-]+/gu, '');
const aliases: Record<string, string> = {
  ml: 'ai', machinelearning: 'ai', ии: 'ai', машинноеобучение: 'ai',
  dataanalysis: 'analytics', аналитика: 'analytics', анализданных: 'analytics',
  forecasting: 'forecasting', прогнозирование: 'forecasting',
  reactjs: 'react', js: 'javascript', ts: 'typescript',
  ux: 'ux/ui', ui: 'ux/ui', uxui: 'ux/ui', дизайн: 'ux/ui',
  naturallanguageprocessing: 'nlp', обработкатекста: 'nlp',
  optimization: 'optimization', оптимизация: 'optimization',
};
const canonical = (value: string) => aliases[normalize(value)] ?? normalize(value);
const technologies = new Set(['python', 'react', 'typescript', 'javascript', 'fastapi', 'django', 'nodejs', 'sql', 'postgresql', 'docker', 'powerbi', 'pandas', 'pytorch', 'tensorflow', 'flutter', 'figma', 'excel', 'nextjs']);
const skillPatterns: { name: string; pattern: RegExp }[] = [
  { name: 'AI', pattern: /\bai\b|\bml\b|машинн|нейросет|искусственн/iu },
  { name: 'Analytics', pattern: /analytic|аналити|анализ данных/iu },
  { name: 'Forecasting', pattern: /forecast|прогноз/iu },
  { name: 'NLP', pattern: /\bnlp\b|классификаци[яи] документ|обработк[аи] текст/iu },
  { name: 'Optimization', pattern: /optimi|оптимизац/iu },
  { name: 'UX/UI', pattern: /ux|интерфейс|дизайн/iu },
  { name: 'Web', pattern: /\bweb\b|веб|портал/iu },
];
const unique = (items: string[]) => [...new Map(items.map(item => [canonical(item), item])).values()];
const overlap = (required: string[], available: string[]) => {
  const supported = new Set(available.map(canonical));
  return required.length ? Math.round(required.filter(item => supported.has(canonical(item))).length / required.length * 100) : 0;
};

export function calculateTeamMatch(task: Task, team: Team): TeamMatchResult {
  const text = `${task.title} ${task.context} ${task.need} ${task.expectedResult} ${task.tags.join(' ')}`;
  const requiredTechnologies = unique(task.tags.filter(tag => technologies.has(canonical(tag))));
  const requiredSkills = unique([
    ...task.tags.filter(tag => !technologies.has(canonical(tag)) && !['retail', 'education', 'fintech', 'healthcare', 'logistics'].includes(canonical(tag))),
    ...skillPatterns.filter(item => item.pattern.test(text)).map(item => item.name),
  ]);
  const requiredInterests = unique([...requiredSkills, task.industry].filter(Boolean));
  const technologyScore = overlap(requiredTechnologies, team.technologies);
  const skills = overlap(requiredSkills, team.skills);
  const interests = overlap(requiredInterests, team.interests);
  const industry = team.industries.some(item => canonical(item) === canonical(task.industry)) ? 100 : 0;
  const allCapabilities = new Set([...team.technologies, ...team.skills, ...team.interests, ...team.industries].map(canonical));
  const requirements = unique([...requiredTechnologies, ...requiredSkills, task.industry].filter(Boolean));
  return {
    total: Math.round(technologyScore * 0.35 + skills * 0.3 + interests * 0.2 + industry * 0.15),
    technologies: technologyScore, skills, interests, industry,
    matching: requirements.filter(item => allCapabilities.has(canonical(item))),
    missing: requirements.filter(item => !allCapabilities.has(canonical(item))),
  };
}
