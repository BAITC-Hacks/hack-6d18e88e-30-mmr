import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// Workers have independent module caches, like tabs, with a shared synchronous
// storage adapter. A single imported store would not reproduce stale snapshots.
const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
function read() { try { return JSON.parse(fs.readFileSync(workerData.file, 'utf8')); } catch { return {}; } }
globalThis.localStorage = {
  getItem(key) { return read()[key] ?? null; },
  setItem(key, value) { fs.writeFileSync(workerData.file, JSON.stringify({ ...read(), [key]: value })); },
  removeItem(key) { const data = read(); delete data[key]; fs.writeFileSync(workerData.file, JSON.stringify(data)); },
};
(async () => {
  await import(workerData.loader);
  const { useAppStore } = await import(workerData.store);
  const { createEmptyTask } = await import(workerData.data);
  parentPort.on('message', ({ action, id }) => {
    try {
      const state = useAppStore.getState();
      if (action === 'add') state.addTask({ ...createEmptyTask(), id, title: id, tags: [' Python ', '', 'Python', '  ', 'React'] });
      if (action === 'navigate') state.navigate('catalog');
      if (action === 'notify') state.notify(null);
      if (action === 'reset') state.resetDemo();
      if (action === 'reload') useAppStore.persist.rehydrate();
      const next = useAppStore.getState();
      parentPort.postMessage({ tasks: next.tasks.map(task => ({ id: task.id, tags: task.tags })), error: next.storageError });
    } catch(error) { parentPort.postMessage({ failure: String(error) }); }
  });
  parentPort.postMessage({ ready: true });
})();
`;
type Reply = { tasks: { id: string; tags: string[] }[]; error: string | null; failure?: string };

test('a stale tab cannot overwrite newer work through navigation or toast dismissal; reload and explicit reset recover', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sana-tab-audit-'));
  const file = join(directory, 'storage.json');
  const workers: Worker[] = [];
  async function openTab() {
    const worker = new Worker(workerCode, { eval: true, execArgv: [],
      workerData: { file, loader: new URL('./loader.mjs', import.meta.url).href, store: new URL('../src/app/store.ts', import.meta.url).href, data: new URL('../src/data/syntheticData.ts', import.meta.url).href } });
    workers.push(worker);
    await new Promise<void>((accept, reject) => { worker.once('message', () => accept()); worker.once('error', reject); });
    return (action: string, id?: string) => new Promise<Reply>((accept, reject) => {
      worker.once('message', reply => reply.failure ? reject(new Error(reply.failure)) : accept(reply));
      worker.postMessage({ action, id });
    });
  }
  const savedIds = () => JSON.parse(JSON.parse(readFileSync(file, 'utf8'))['ai-sana-taskrank-v1']).state.tasks.map((task: { id: string }) => task.id);
  try {
    const tabA = await openTab(); const tabB = await openTab();
    const added = await tabA('add', 'from-tab-a');
    assert.deepEqual(added.tasks.find(task => task.id === 'from-tab-a')?.tags, ['Python', 'React']);
    assert.ok(savedIds().includes('from-tab-a'));
    const stale = await tabB('navigate');
    assert.ok(!stale.tasks.some(task => task.id === 'from-tab-a'));
    assert.match(stale.error || '', /другой вкладке.*перезагрузите/);
    assert.ok(savedIds().includes('from-tab-a'), 'Navigation must not replace the newer full snapshot.');
    await tabB('notify');
    assert.ok(savedIds().includes('from-tab-a'), 'Toast dismissal must not bypass conflict detection.');
    const reloaded = await tabB('reload');
    assert.ok(reloaded.tasks.some(task => task.id === 'from-tab-a'));
    const afterReload = await tabB('add', 'from-tab-b');
    assert.equal(afterReload.error, null);
    assert.ok(savedIds().includes('from-tab-a') && savedIds().includes('from-tab-b'));
    const staleReset = await tabA('reset');
    assert.equal(staleReset.error, null);
    assert.ok(!savedIds().includes('from-tab-a') && !savedIds().includes('from-tab-b'), 'An explicit confirmed reset may replace the latest snapshot.');
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes('ai-sana-tab-audit-'));
    rmSync(target, { recursive: true, force: true });
  }
});
