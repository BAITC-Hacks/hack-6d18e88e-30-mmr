import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local browser review with an isolated browser profile. The optional audit
// scenario permits only same-origin AI requests against the launcher's fixture.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = { url: 'http://localhost:5173', width: 1440, height: 1000, out: 'baseline', clicks: [] };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value for ${flag}`);
  if (flag === '--url') options.url = value;
  else if (flag === '--width' || flag === '--height') options[flag.slice(2)] = Number(value);
  else if (flag === '--out') options.out = value;
  else if (flag === '--click') options.clicks.push(value);
  else if (flag === '--scenario' && value === 'audit') options.scenario = value;
  else throw new Error(`Unknown option ${flag}`);
}
for (const dimension of ['width', 'height']) {
  if (!Number.isInteger(options[dimension]) || options[dimension] < 240 || options[dimension] > 4096) {
    throw new Error(`${dimension} must be an integer between 240 and 4096`);
  }
}
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(options.out)) throw new Error('--out must be a short file name, without a path');
const isLocal = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
};
if (!isLocal(options.url)) throw new Error('Only local HTTP URLs can be reviewed');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const temporaryRoot = await realpath(tmpdir());
const profile = await mkdtemp(path.join(temporaryRoot, 'ai-sana-browser-review-'));
const outputDirectory = path.join(root, 'backend', 'data', 'design-review');
await mkdir(outputDirectory, { recursive: true });
let chrome;
let socket;
let nextId = 0;
let sessionId;
const pending = new Map();
const blockedRequests = new Map();
const pageErrors = [];
const apiResponses = [];
let command;
let deadline;
let childExited = false;

async function removeOwnProfile() {
  // Verify the final resolved target before the only recursive removal below.
  const resolved = await realpath(profile);
  const expected = path.resolve(profile);
  if (resolved !== expected || path.dirname(resolved) !== temporaryRoot
      || !path.basename(resolved).startsWith('ai-sana-browser-review-')) {
    throw new Error('Refusing to remove an unexpected browser profile path');
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

try {
  chrome = spawn(chromePath, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-default-apps', '--disable-extensions', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  chrome.once('exit', () => { childExited = true; });
  let spawnFailure;
  chrome.once('error', (error) => { spawnFailure = error; });
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (spawnFailure) throw spawnFailure;
    if (childExited) throw new Error('Chrome exited before CDP became available');
    try {
      const [port, websocketPath] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      if (/^\d+$/.test(port) && websocketPath?.startsWith('/devtools/browser/')) {
        endpoint = `ws://127.0.0.1:${port}${websocketPath}`;
        break;
      }
    } catch (error) {
      // Chromium may briefly lock this file while writing it on Windows.
      if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error;
    }
    await delay(100);
  }
  if (!endpoint) throw new Error('Chrome did not create its CDP endpoint within 10 seconds');
  socket = new WebSocket(endpoint);
  await Promise.race([once(socket, 'open'), delay(10000).then(() => { throw new Error('CDP connection timed out'); })]);
  command = (method, params = {}, targetSession = sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(targetSession ? { sessionId: targetSession } : {}) }));
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result || {});
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const aiRequest = options.scenario === 'audit' && request.method === 'POST'
        && new URL(request.url).origin === new URL(options.url).origin
        && /^\/api\/ai\/(analyze|clarify)$/.test(new URL(request.url).pathname);
      const allowed = aiRequest || request.method === 'GET' && (isLocal(request.url) || request.url.startsWith('data:'));
      if (!allowed) {
        // Record the origin only: URLs and request headers may contain tokens.
        let origin = 'non-http';
        try { origin = new URL(request.url).origin; } catch {}
        const key = `${request.method} ${origin}`;
        blockedRequests.set(key, (blockedRequests.get(key) || 0) + 1);
      }
      command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }, message.sessionId)
        .catch(() => {});
    } else if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails.text);
    } else if (message.method === 'Network.responseReceived') {
      const { response } = message.params;
      const url = new URL(response.url);
      if (url.origin === new URL(options.url).origin && url.pathname.startsWith('/api/')) {
        apiResponses.push({ path: url.pathname, status: response.status });
      }
    }
  });
  deadline = setTimeout(() => { socket.close(); chrome.kill(); }, options.scenario ? 120000 : 45000);
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await command('Target.attachToTarget', { targetId, flatten: true }, null));
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Network.enable');
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  await command('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await command('Emulation.setDeviceMetricsOverride', {
    width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false,
  });
  const navigation = await command('Page.navigate', { url: options.url });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`Page evaluation failed: ${result.exceptionDetails.text}`);
    return result.result.value;
  };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate('document.readyState === "complete" && Boolean(document.querySelector("#root")?.children.length)')) break;
    if (attempt === 99) throw new Error('Application did not render within 10 seconds');
    await delay(100);
  }
  await evaluate('document.fonts.ready.then(() => true)');
  await delay(500);
  for (const selector of options.clicks) {
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Click selector not found'); element.click(); return true; })()`);
    await delay(350);
  }
  let scenarioReport;
  if (options.scenario === 'audit') {
    const { auditBrowser } = await import('../tests/browser_audit_scenario.mjs');
    scenarioReport = await auditBrowser({ evaluate, command, delay, outputDirectory, name: options.out });
  }
  const metrics = await evaluate(`(() => {
    const viewport = { width: innerWidth, height: innerHeight };
    const overflowing = [...document.querySelectorAll('body *')].flatMap((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!box.width || !box.height || style.display === 'none' || style.visibility === 'hidden') return [];
      if (box.left >= -1 && box.right <= innerWidth + 1) return [];
      return [{ tag: element.tagName.toLowerCase(), className: String(element.className).slice(0, 180),
        left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) }];
    }).slice(0, 25);
    return { title: document.title, pathname: location.pathname, viewport,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      headings: [...document.querySelectorAll('h1,h2')].map((element) => element.textContent.trim()).slice(0, 20),
      overflowing,
      brokenImages: [...document.images].filter((element) => element.complete && !element.naturalWidth).length };
  })()`);
  const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotPath = path.join(outputDirectory, `${options.out}.png`);
  const metricsPath = path.join(outputDirectory, `${options.out}.json`);
  await writeFile(screenshotPath, Buffer.from(data, 'base64'));
  const report = { ...metrics, pageErrors, apiResponses, blockedRequests: Object.fromEntries(blockedRequests), scenarioReport };
  await writeFile(metricsPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ screenshotPath, metricsPath, ...report,
    scenarioReport: scenarioReport ? { checks: scenarioReport.checks, screenshots: scenarioReport.screenshots.length } : undefined }, null, 2));
  if (pageErrors.length || metrics.horizontalOverflow || metrics.brokenImages) process.exitCode = 1;
  if (options.scenario && !apiResponses.some(response => response.path === '/api/ai/analyze' && response.status === 200)) process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (socket?.readyState === WebSocket.OPEN && command) {
    await command('Browser.close', {}, null).catch(() => {});
  }
  socket?.close();
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error('Browser review finished'));
  }
  pending.clear();
  if (chrome && !childExited) {
    await Promise.race([once(chrome, 'exit').catch(() => {}), delay(3000)]);
    if (!childExited) chrome.kill();
  }
  await removeOwnProfile();
}
