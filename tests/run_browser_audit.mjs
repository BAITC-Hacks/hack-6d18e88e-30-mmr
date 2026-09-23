import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { preview } from '../frontend/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = await realpath(tmpdir());
const temporary = await mkdtemp(path.join(temporaryRoot, 'ai-sana-browser-audit-'));
const freePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
const apiPort = await freePort();
const sitePort = await freePort();
const origin = `http://127.0.0.1:${sitePort}`;
// Read no .env files, send no real email, and never use cloud AI/account keys.
const environment = { ...process.env, APP_ENV: 'development', PYTHON_DOTENV_DISABLED: '1',
  OPENAI_API_KEY: '', NVIDIA_API_KEY: '', AI_MODEL: '', API_ACCESS_TOKEN: '',
  API_ALLOWED_HOSTS: 'localhost,127.0.0.1', API_ALLOWED_ORIGINS: origin, AUTH_PROVIDER: 'local',
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '',
  SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_PORT: '587', MAIL_BACKEND: 'file',
  MAIL_WORKER_ENABLED: 'false', COOKIE_SECURE: 'false', DATABASE_PATH: path.join(temporary, 'audit.sqlite3'),
  MAIL_DIRECTORY: path.join(temporary, 'mail'), AUTH_PAGE_URL: `${origin}/auth`, UNSUBSCRIBE_PAGE_URL: `${origin}/account` };
let backend;
let server;
let browser;
let backendOutput = '';
async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, resolve));
  } else child.kill('SIGTERM');
}
try {
  backend = spawn(path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(apiPort), '--no-proxy-headers'],
    { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnFailure;
  backend.once('error', error => { spawnFailure = error; });
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', data => { backendOutput = (backendOutput + data).slice(-12000); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnFailure) throw spawnFailure;
    if (backend.exitCode !== null) throw new Error(`Isolated backend exited: ${backendOutput}`);
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(500) });
      ready = response.ok; await response.body.cancel();
      if (ready) break;
    } catch { /* bounded local readiness */ }
    await delay(100);
  }
  assert.ok(ready, 'Isolated backend becomes healthy');
  server = await preview({ root: path.join(root, 'frontend'), preview: { host: '127.0.0.1', port: sitePort, strictPort: true,
    open: false, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
  const widths = (process.env.BROWSER_AUDIT_WIDTHS || '1440,768,390,320').split(',').map(Number);
  assert.ok(widths.length <= 4 && widths.every(width => [1440, 768, 390, 320].includes(width)));
  for (const width of widths) {
    browser = spawn(process.execPath, ['scripts/browser-review.mjs', '--url', origin, '--width', String(width),
      '--height', '1000', '--out', `audit-${width}`, '--scenario', 'audit'], { cwd: root, windowsHide: true, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { browser.once('error', reject); browser.once('exit', resolve); });
    assert.equal(code, 0, `Chromium audit at ${width}px`);
  }
  console.log('PASS: isolated production browser flow, desktop/mobile, actual HTTP AI, persistence, modal keyboard and layouts.');
} finally {
  await terminate(browser);
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
  await terminate(backend);
  const resolved = await realpath(temporary);
  assert.equal(path.dirname(resolved), temporaryRoot);
  assert.ok(path.basename(resolved).startsWith('ai-sana-browser-audit-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
