import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pythonPath = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(pythonPath) ? pythonPath : 'python';
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
run(python, ['-m', 'pytest', 'tests', '-q']);
run(python, ['tests/smoke_backend.py']);
run(process.execPath, ['supabase/tests/run-migrations.mjs']);
if (!process.env.npm_execpath) throw new Error('Run this check with npm run check.');
for (const step of ['test', 'lint', 'build']) {
  run(process.execPath, [process.env.npm_execpath, '--prefix', 'frontend', 'run', step]);
}
console.log('\nAll core checks passed.');
