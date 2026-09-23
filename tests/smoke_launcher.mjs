// Isolated lifecycle smoke. Needs the launcher's fixed local ports to be free.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'ai-sana-launcher-test-'));
const environment = { ...process.env, BROWSER: 'none', PYTHON_DOTENV_DISABLED: '1', OPENAI_API_KEY: '', NVIDIA_API_KEY: '',
  AI_MODEL: '', API_ACCESS_TOKEN: '', API_ALLOWED_HOSTS: 'localhost,127.0.0.1',
  API_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173', AUTH_PROVIDER: 'local',
  SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '',
  SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_PORT: '587',
  MAIL_BACKEND: 'file', MAIL_WORKER_ENABLED: 'false', COOKIE_SECURE: 'false',
  DATABASE_PATH: path.join(temporary, 'accounts.sqlite3'), MAIL_DIRECTORY: path.join(temporary, 'mail'),
  AUTH_PAGE_URL: 'http://localhost:5173/auth', UNSUBSCRIBE_PAGE_URL: 'http://localhost:8000/account' };
let current;

async function bind(port, host = '127.0.0.1') {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port, exclusive: true, ipv6Only: true }, resolve);
  });
  return server;
}

async function assertPortsFree() {
  for (const port of [8000, 5173]) {
    const server = await bind(port);
    await new Promise(resolve => server.close(resolve));
  }
}

function launch(overrides = {}) {
  // Invoke the same SIGINT handler on Windows without an interactive console.
  // This preload belongs only to the smoke test, never to npm start.
  const preload = "process.on('message', message => { if (message === 'stop') process.emit('SIGINT'); });";
  const child = fork(path.join(root, 'scripts/start.mjs'), [], {
    cwd: root, env: { ...environment, ...overrides }, windowsHide: true,
    execArgv: ['--import', `data:text/javascript,${encodeURIComponent(preload)}`],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-64000); });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code));
  });
  current = { child, exited, output: () => output };
  return current;
}

async function untilExit(instance) {
  const deadline = Date.now() + 30000;
  while (instance.child.exitCode === null && Date.now() < deadline) await delay(100);
  if (instance.child.exitCode === null) throw new Error('Launcher did not exit within 30 seconds.');
  return instance.exited;
}

try {
  await assertPortsFree();
  const occupied = await bind(5173);
  try {
    const blocked = launch();
    assert.equal(await untilExit(blocked), 1);
    assert.match(blocked.output(), /Порт 5173 занят/);
    assert.equal(occupied.listening, true, 'Unrelated listener must be left running.');
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
  console.log('PASS: occupied port is reported without stopping its owner.');

  let ipv6;
  try { ipv6 = await bind(5173, '::1'); }
  catch (error) { if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) throw error; }
  if (ipv6) {
    try {
      const blocked = launch();
      assert.equal(await untilExit(blocked), 1);
      assert.match(blocked.output(), /Порт 5173 занят/);
      assert.equal(ipv6.listening, true);
    } finally {
      await new Promise(resolve => ipv6.close(resolve));
    }
    console.log('PASS: an existing IPv6 localhost listener cannot shadow the app.');
  }

  const cancelled = launch();
  await delay(500);
  cancelled.child.send('stop');
  assert.equal(await untilExit(cancelled), 0, cancelled.output());
  await assertPortsFree();
  console.log('PASS: cancelling startup never leaves either server running.');

  const app = launch();
  const deadline = Date.now() + 45000;
  let ready = false;
  while (app.child.exitCode === null && Date.now() < deadline) {
    try {
      const page = await fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(1000) });
      const html = await page.text();
      if (page.ok && html.includes('/assets/')) { ready = true; break; }
    } catch { /* Wait for the real build and both servers. */ }
    await delay(200);
  }
  assert.equal(ready, true, app.output());
  const proxy = await fetch('http://127.0.0.1:5173/api/health');
  assert.equal(proxy.status, 200);
  assert.equal((await proxy.json()).service, 'ai-sana-taskrank');
  const authRoute = await fetch('http://127.0.0.1:5173/auth');
  assert.equal(authRoute.status, 200);
  await authRoute.body.cancel();
  app.child.send('stop');
  assert.equal(await untilExit(app), 0, app.output());
  await assertPortsFree();
  console.log('PASS: production assets, SPA route and API proxy respond; SIGINT handler releases both ports.');

  const protectedApi = launch({ API_ACCESS_TOKEN: 'launcher-test-token-12345678901234567890' });
  assert.equal(await untilExit(protectedApi), 1, protectedApi.output());
  assert.match(protectedApi.output(), /API требует серверный токен/);
  await assertPortsFree();
  console.log('PASS: protected API fails explicitly and the launcher cleans up its backend.');

  const brokenBackend = launch({ SMTP_PORT: 'invalid-test-port' });
  assert.equal(await untilExit(brokenBackend), 1, brokenBackend.output());
  await assertPortsFree();
  console.log('PASS: backend configuration failure exits without leaving servers.');
} finally {
  if (current?.child.exitCode === null) {
    current.child.send('stop');
    await untilExit(current);
  }
  // Verify the resolved target before removing this test's own temporary files.
  const resolvedTemporary = await realpath(temporary);
  assert.equal(path.dirname(resolvedTemporary), await realpath(os.tmpdir()));
  assert.ok(path.basename(resolvedTemporary).startsWith('ai-sana-launcher-test-'));
  await rm(resolvedTemporary, { recursive: true, force: true });
}
