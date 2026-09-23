import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyTask, seedTeams } from '../src/data/syntheticData.ts';
import { calculateTeamMatch, getRecommendedTasksForTeam } from '../src/services/teamMatchService.ts';

const team = (technologies: string[]) => ({ ...seedTeams[0], technologies, skills: [], interests: [], industries: [] });
const task = (tags: string[], constraints = '') => ({ ...createEmptyTask(), title: '', industry: '', tags, constraints });

test('explicit prefix and postfix technology bans cover lists in Russian, English and Kazakh', () => {
  for (const constraints of [
    'Не использовать Python и React.', 'Python и React не использовать.',
    'Запрещено использовать Python, React.', 'Python, React запрещены.',
    'Не применять Python или React.', 'Без использования Python и React.',
    'Do not use Python or React.', 'Python and React are not allowed.',
    'No Python, React.', 'Python and React must not be used.',
    'Python мен React қолдануға болмайды.', 'Python және React пайдалануға болмайды.',
  ]) {
    const result = calculateTeamMatch(task(['Python', 'React'], constraints), team(['Python', 'React']));
    assert.equal(result.technologies, 0, constraints);
    assert.deepEqual(result.matching, [], constraints);
    assert.deepEqual(result.missing, [], 'Forbidden labels are not recommendations to gain a missing skill.');
  }
});

test('negated prohibitions and unrelated prohibitions keep a permitted technology matched', () => {
  for (const constraints of [
    'Не запрещено использовать Python.', 'Python не запрещён.',
    'Python is not forbidden.', 'It is not forbidden to use Python.',
    'Python қолдануға болады.', 'Python пайдалануға болады.',
    'Не использовать Excel. Python разрешён.',
    'Не использовать Excel и React; используйте Python.',
  ]) assert.equal(calculateTeamMatch(task(['Python'], constraints), team(['Python'])).technologies, 100, constraints);
  const scoped = calculateTeamMatch(task(['Python', 'React'], 'Не использовать Python, но React разрешён.'), team(['Python', 'React']));
  assert.equal(scoped.technologies, 100);
  assert.deepEqual(scoped.matching, ['React']);
});

test('compound technology names neither require nor credit their shorter names', () => {
  const native = task(['React Native']);
  assert.equal(calculateTeamMatch(native, team(['React Native'])).technologies, 100);
  assert.equal(calculateTeamMatch(native, team(['React'])).technologies, 0);
  assert.equal(calculateTeamMatch(native, team(['React Native', 'React'])).technologies, 100);
  assert.equal(calculateTeamMatch(task(['React', 'React Native']), team(['React Native'])).technologies, 50);
  assert.equal(calculateTeamMatch(task(['React Native'], 'React Native запрещён.'), team(['React'])).technologies, 0);
  assert.equal(calculateTeamMatch(task(['Node.js', 'C++', 'C#']), team(['Node.js', 'C++', 'C#'])).technologies, 100);
  assert.equal(calculateTeamMatch(task(['Node.js', 'C++', 'C#'], 'Не использовать Node.js, C++ и C#.'), team(['Node.js', 'C++', 'C#'])).technologies, 0);
});

test('matching stays monotonic for irrelevant labels, bounded and inclusive of low-ranked published tasks', () => {
  const python = task(['Python']);
  const initial = calculateTeamMatch(python, team(['Python']));
  assert.deepEqual(calculateTeamMatch(python, team(['Python', 'Swift', 'Elixir'])), initial);
  const publications = [
    { ...python, id: 'low', published: true, rating: 0 },
    { ...task(['Python'], 'Не использовать Python.'), id: 'unmatched', published: true, rating: 100 },
    { ...python, id: 'draft', published: false },
  ];
  const recommended = getRecommendedTasksForTeam(team(['Python']), publications);
  assert.deepEqual(new Set(recommended.map(item => item.task.id)), new Set(['low', 'unmatched']));
  assert.ok(recommended.every(item => [item.match.total, item.match.technologies, item.match.skills, item.match.interests, item.match.industry].every(value => value >= 0 && value <= 100)));
});
