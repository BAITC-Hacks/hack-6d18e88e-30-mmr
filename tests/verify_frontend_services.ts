import assert from 'node:assert/strict';
import { calculateRating, getReadinessLevel } from '../frontend/src/services/ratingService';
import { calculateTeamMatch, getRecommendedTasksForTeam } from '../frontend/src/services/teamMatchService';
import { seedDrafts, seedTasks, seedTeams, seedProposals } from '../frontend/src/data/syntheticData';
import type { Task } from '../frontend/src/types/task';
import type { Team } from '../frontend/src/types/team';

const ratingFields = [
  'context', 'need', 'availableData', 'expectedResult', 'successCriteria',
  'constraints', 'targetUsers', 'contact', 'consultationFormat',
] as const;
const blankTask: Task = {
  ...seedTasks[0], title: '', industry: '', tags: [], context: '', need: '', availableData: '',
  expectedResult: '', successCriteria: '', constraints: '', targetUsers: '', contact: '',
  consultationFormat: '', confirmedFields: [], rating: 0, readinessLevel: 'draft', confirmed: false,
};
const blankTeam: Team = {
  ...seedTeams[0], technologies: [], skills: [], interests: [], industries: [], progressPoints: 0,
};
const fullText = 'Подробное описание с конкретными исходными условиями и проверяемым результатом работы команды.';

// Actual points require both text and confirmation; potential reflects current text only.
assert.equal(calculateRating(blankTask).total, 0);
assert.equal(calculateRating(blankTask).potentialTotal, 0);
assert.equal(calculateRating({ ...seedTasks[0], confirmedFields: [] }).total, 0);
assert.equal(calculateRating({ ...seedTasks[0], confirmedFields: [] }).potentialTotal, 100);
assert.equal(calculateRating({ ...blankTask, confirmedFields: [...ratingFields] }).total, 0);
for (const placeholder of ['Не указано', 'Не указаны', 'Требует уточнения', 'Требуется уточнение', 'Будет уточнено', 'Не заполнено', 'Неизвестно', 'Нет данных', 'TBD', 'unknown', 'not provided', 'N/A', '??????', '      ']) {
  const task = { ...blankTask, confirmedFields: [...ratingFields] };
  for (const field of ratingFields) task[field] = placeholder;
  assert.equal(calculateRating(task).total, 0, `Placeholder must not earn points: ${placeholder}`);
  assert.equal(calculateRating(task).potentialTotal, 0);
}
assert.equal(calculateRating({ ...blankTask, constraints: 'Нет ограничений по используемым технологиям.', confirmedFields: ['constraints'] }).constraints, 10);
assert.equal(calculateRating({ ...blankTask, contact: 'lead@demo.kz', confirmedFields: ['contact'] }).businessCommunication, 5);
const contextOnly = calculateRating({ ...blankTask, context: fullText, confirmedFields: ['context', 'context', 'unrecognized'] });
assert.equal(contextOnly.contextNeed, 10);
assert.equal(contextOnly.recommendations.some((recommendation) => recommendation.field === 'context'), false);
assert.equal(contextOnly.recommendations.find((recommendation) => recommendation.field === 'need')?.possibleGain, 10);

for (const [score, level] of [[0, 'draft'], [39, 'draft'], [40, 'working'], [69, 'working'], [70, 'ready'], [89, 'ready'], [90, 'priority'], [100, 'priority']] as const) {
  assert.equal(getReadinessLevel(score), level);
}

// Each advertised +N must be obtainable by completing that exact field alone.
const ratingFixtures = [blankTask, ...seedTasks, { ...blankTask, availableData: 'Краткие данные', confirmedFields: ['availableData'] }];
for (const task of ratingFixtures) {
  const before = JSON.stringify(task);
  const breakdown = calculateRating(task);
  assert.equal(JSON.stringify(task), before, 'Rating is pure');
  assert.ok(breakdown.total >= 0 && breakdown.total <= breakdown.potentialTotal && breakdown.potentialTotal <= 100);
  assert.equal(breakdown.total, breakdown.contextNeed + breakdown.data + breakdown.expectedResult + breakdown.successCriteria + breakdown.constraints + breakdown.users + breakdown.businessCommunication);
  assert.equal(breakdown.total + breakdown.recommendations.reduce((sum, recommendation) => sum + recommendation.possibleGain, 0), 100);
  assert.equal(new Set(breakdown.recommendations.map((recommendation) => recommendation.field)).size, breakdown.recommendations.length);
  for (const [index, recommendation] of breakdown.recommendations.entries()) {
    assert.ok(recommendation.message.includes(`(+${recommendation.possibleGain} б.)`));
    if (index > 0) assert.ok(breakdown.recommendations[index - 1].possibleGain >= recommendation.possibleGain);
    const improved = { ...task, [recommendation.field]: fullText, confirmedFields: [...task.confirmedFields, recommendation.field] };
    assert.equal(calculateRating(improved).total - breakdown.total, recommendation.possibleGain, `Incorrect gain for ${recommendation.field}`);
  }
}

// Demo fixtures must agree with scoring, cover all readiness levels, and have valid links.
for (const seeds of [seedDrafts, seedTasks, seedTeams, seedProposals]) {
  assert.ok(seeds.length >= 5);
  assert.equal(new Set(seeds.map((item) => item.id)).size, seeds.length);
}
for (const task of seedTasks) {
  assert.equal(task.rating, calculateRating(task).total);
  assert.equal(task.readinessLevel, getReadinessLevel(task.rating));
}
assert.deepEqual(new Set(seedTasks.map((task) => task.readinessLevel)), new Set(['draft', 'working', 'ready', 'priority']));
for (const proposal of seedProposals) {
  assert.ok(seedTasks.some((task) => task.id === proposal.taskId));
  assert.ok(seedTeams.some((team) => team.id === proposal.teamId));
  assert.ok(proposal.idea && proposal.implementationPlan && proposal.estimatedTime && proposal.prototypeUrl);
}

// Empty profiles cannot receive inferred compatibility or match empty industry labels.
assert.deepEqual(calculateTeamMatch(blankTask, blankTeam), {
  total: 0, technologies: 0, skills: 0, interests: 0, industry: 0, matchedTags: [],
});
assert.equal(calculateTeamMatch(seedTasks[0], { ...blankTeam, industries: [' ', ''] }).total, 0);
assert.equal(calculateTeamMatch({ ...blankTask, title: 'GovTech Django FastAPI PostgreSQL' }, { ...blankTeam, technologies: ['Go', 'SQL', 'API'] }).technologies, 0);
const phraseMatch = calculateTeamMatch({ ...blankTask, tags: ['Next.js', 'C++', 'C#', 'Node.js', 'Data Science', 'Қазақ тілі'], industry: 'Smart City & GovTech' }, {
  ...blankTeam, technologies: ['next.js', 'c++', 'C#', 'Nodejs'], skills: ['Data Science', 'Қазақ тілі'], interests: ['Smart City'], industries: ['Smart City & GovTech'],
});
assert.equal(phraseMatch.total, 100, 'Multiword, Unicode and punctuation labels must match');
assert.equal(calculateTeamMatch({ ...blankTask, tags: ['C++', 'C#'] }, { ...blankTeam, technologies: ['C'] }).technologies, 0);
const pythonTask = { ...blankTask, tags: ['Python'] };
const uniqueTeam = { ...blankTeam, technologies: ['Python', 'Rust'] };
const duplicateTeam = { ...blankTeam, technologies: ['Python', 'python', ' Python ', 'Rust', ''] };
assert.deepEqual(calculateTeamMatch(pythonTask, duplicateTeam), calculateTeamMatch(pythonTask, uniqueTeam), 'Duplicates cannot inflate the score');
const overlap = calculateTeamMatch({ ...pythonTask, industry: 'Python' }, { ...blankTeam, technologies: ['Python'], skills: ['python'], interests: [' PYTHON '], industries: ['Python'] });
assert.deepEqual(overlap.matchedTags, ['Python']);
assert.equal(calculateTeamMatch({ ...blankTask, need: 'FinTech API', industry: 'Retail' }, { ...blankTeam, industries: ['FinTech'] }).industry, 0, 'Industry relevance uses the actual industry');
assert.deepEqual(calculateTeamMatch(seedTasks[0], seedTeams[0]), calculateTeamMatch(seedTasks[0], { ...seedTeams[0], progressPoints: 999999 }), 'Progress points do not affect relevance');
assert.ok(calculateTeamMatch(seedTasks[0], seedTeams[0]).total >= 50, 'FinTech task remains relevant to DataWhales');
for (const task of seedTasks) {
  for (const team of seedTeams) {
    const result = calculateTeamMatch(task, team);
    for (const key of ['total', 'technologies', 'skills', 'interests', 'industry'] as const) {
      assert.ok(Number.isInteger(result[key]) && result[key] >= 0 && result[key] <= 100);
    }
  }
}

// Recommendations do not remove low readiness or low relevance from the public pool.
const catalog = [...seedTasks, { ...blankTask, id: 'private', published: false }];
const beforeCatalog = JSON.stringify(catalog);
const recommendations = getRecommendedTasksForTeam(blankTeam, catalog);
assert.equal(recommendations.length, seedTasks.length);
assert.ok(recommendations.some(({ task }) => task.readinessLevel === 'draft'));
assert.equal(JSON.stringify(catalog), beforeCatalog, 'Sorting must not mutate source tasks');
for (let index = 1; index < recommendations.length; index++) {
  assert.ok(recommendations[index - 1].match.total >= recommendations[index].match.total);
}

console.log('PASS: rating confirmation, potential, exact gains, seed consistency and TeamMatch regressions');
