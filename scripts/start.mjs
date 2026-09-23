// Local production-build preview. Public deployment still needs a secure gateway.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = path.join(root, 'frontend');
const requireFrontend = createRequire(path.join(frontend, 'package.json'));
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const children = new Map();
let previewServer;
let stopping = false;

function run(command, args, cwd, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Процесс ${path.basename(command)} завершился: ${signal ?? code}.`));
    });
  });
  children.set(child, completion);
  completion.then(() => children.delete(child), () => children.delete(child));
  return completion;
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  console.log('\nОстанавливаю локальный запуск…');
  // Only terminate processes created by this launcher; never kill by port/name.
  const force = setTimeout(() => {
    for (const child of children.keys()) child.kill('SIGKILL');
    process.exit(code);
  }, 5000);
  force.unref();
  const pending = [...children.values()];
  if (previewServer) {
    previewServer.httpServer.closeAllConnections();
    pending.push(new Promise(resolve => previewServer.httpServer.close(resolve)));
  }
  // Windows delivers console Ctrl+C to Python too: allow its lifespan to finish
  // before child.kill(), which is a forced termination on Windows.
  if (code === 0) await Promise.race([Promise.allSettled(pending), delay(1000)]);
  for (const child of children.keys()) child.kill('SIGTERM');
  await Promise.allSettled(pending);
  clearTimeout(force);
  // Let Vite/native build workers release their handles before Node exits.
  process.exitCode = code;
  if (process.connected) process.disconnect();
}

function fail(error) {
  if (stopping) return;
  console.error(`\nЗапуск остановлен: ${error.message}`);
  void stop(1);
}

for (const signal of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) {
  process.on(signal, () => { void stop(0); });
}

async function checkPort(port, host) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) return resolve();
      reject(new Error(error.code === 'EADDRINUSE'
        ? `Порт ${port} занят. Останови прежний запуск через Ctrl+C и повтори npm start.`
        : `Порт ${port} недоступен (${error.code}).`));
    });
    probe.listen({ host, port, exclusive: true, ipv6Only: true }, () => probe.close(resolve));
  });
}

async function waitForBackend() {
  const deadline = Date.now() + 15000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error(`Backend /health: HTTP ${response.status}. Проверь API_ALLOWED_HOSTS.`);
      const health = await response.json();
      if (health.service !== 'ai-sana-taskrank') throw new Error('На порту 8000 ответил другой сервис.');
      const api = await fetch('http://127.0.0.1:8000/api/health', {
        headers: { Origin: 'http://localhost:5173' }, signal: AbortSignal.timeout(1000),
      });
      if (api.status === 401) throw new Error('API требует серверный токен API_ACCESS_TOKEN. Локальный preview не настроен как защищённый gateway.');
      if (!api.ok) throw new Error(`API вернул HTTP ${api.status}. Проверь разрешённые Host/Origin для localhost:5173.`);
      await api.body?.cancel();
      return;
    } catch (error) {
      // Retry only connection/startup failures, not a running API's refusal.
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
    await delay(200);
  }
  if (!stopping) throw new Error('Backend не запустился за 15 секунд. Проверь его сообщения выше.');
}

async function main() {
  if (!existsSync(python)) {
    throw new Error('Не найдена .venv. Выполни python -m venv .venv и установи backend/requirements-dev.txt по README.');
  }
  let tsc;
  let viteUrl;
  try {
    tsc = requireFrontend.resolve('typescript/bin/tsc');
    viteUrl = pathToFileURL(requireFrontend.resolve('vite')).href;
  } catch {
    throw new Error('Не установлены frontend-зависимости. Выполни npm --prefix frontend ci.');
  }
  // localhost may prefer IPv6: an old ::1 listener must not shadow this app.
  await Promise.all([8000, 5173].flatMap(port => ['127.0.0.1', '::1'].map(host => checkPort(port, host))));
  if (stopping) return;
  console.log('Собираю production frontend…');
  await run(process.execPath, [tsc, '-b'], frontend);
  if (stopping) return;
  // Keep Vite's loadEnv(process.cwd()) consistent with npm --prefix frontend.
  process.chdir(frontend);
  process.env.NODE_ENV = 'production';
  const vite = await import(viteUrl);
  if (stopping) return;
  await vite.build({ root: frontend, mode: 'production' });
  if (stopping) return;

  console.log('\nЗапускаю локальный backend на 127.0.0.1:8000…');
  void run(python, ['-m', 'uvicorn', 'main:app', '--app-dir', 'backend',
    '--host', '127.0.0.1', '--port', '8000', '--no-proxy-headers'], root,
  { ...process.env, APP_ENV: 'development' }).then(
    () => fail(new Error('Backend остановился.')),
    fail,
  );
  await waitForBackend();
  if (stopping) return;
  previewServer = await vite.preview({ root: frontend, mode: 'production',
    preview: { host: '127.0.0.1', port: 5173, strictPort: true, open: 'http://localhost:5173' } });
  if (stopping) {
    previewServer.httpServer.closeAllConnections();
    await new Promise(resolve => previewServer.httpServer.close(resolve));
    return;
  }
  console.log('\nГотово: http://localhost:5173\nАккаунт: http://localhost:5173/auth');
  console.log('Production-сборка запущена локально. Остановка всего приложения: Ctrl+C.');
}

main().catch(fail);
