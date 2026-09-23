import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const runner = require.resolve('tsx/cli');
const files = readdirSync(path.join(root, 'tests')).filter(name => /^verify_.*\.ts$/.test(name)).sort();
for (const file of files) {
  console.log(`\nChecking ${file}`);
  const result = spawnSync(process.execPath, [runner, path.join(root, 'tests', file)], { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`\nPassed ${files.length} frontend regression suites.`);
