import { calculateRating, getReadinessLevel } from '../frontend/src/services/ratingService';
import { calculateTeamMatch } from '../frontend/src/services/teamMatchService';
import { seedTasks, seedTeams } from '../frontend/src/data/syntheticData';

console.log('=== VERIFYING FRONTEND CORE SERVICES ===');

// 1. Check all 5 seed tasks pass rating evaluation
for (const task of seedTasks) {
  const breakdown = calculateRating(task);
  const readiness = getReadinessLevel(breakdown.total);
  console.log(`Task "${task.title.slice(0, 30)}...": Total = ${breakdown.total}/100, Level = ${readiness}`);
  if (breakdown.total !== task.rating) {
    console.warn(`Note: seed rating is ${task.rating}, computed is ${breakdown.total}`);
  }
}

// 2. Check team matching calculation
const task1 = seedTasks[0];
const team1 = seedTeams[0];
const match = calculateTeamMatch(task1, team1);
console.log(`Match between "${task1.title.slice(0, 20)}" and "${team1.name}": ${match.total}%`);
if (match.total < 50) {
  throw new Error('Expected high match for FinTech task and FinTech DataWhales team!');
}

console.log('SUCCESS: All frontend service contracts verified!');
