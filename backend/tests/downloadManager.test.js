const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DownloadManager, safeFilename } = require('../services/downloadManager');
const { createConfig } = require('../config');

const option = { id: 'mp4-720', type: 'video', format: 'mp4', quality: '720p', selector: '22', requiresConversion: false };
const info = { public: { url: 'https://example.com/video', title: 'Shared title', thumbnail: '' }, raw: { title: 'Shared title' }, options: [option] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out awaiting test state'); await delay(5); }
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gsd-manager-test-'));
  const calls = [];
  let clock = 1;
  const metadata = { requests: [], async get(url, flags) { this.requests.push({ url, flags }); return info; } };
  const runner = args => new Promise((resolve, reject) => {
    const call = { ...args, fail: reject, async finish(contents = 'media') { const filePath = path.join(args.tempDir, 'media.mp4'); await fs.writeFile(filePath, contents); resolve({ filePath, size: Buffer.byteLength(contents) }); } };
    calls.push(call);
    args.signal.addEventListener('abort', () => setTimeout(() => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), options.abortDelay || 0), { once: true });
  });
  const config = createConfig({ tempRoot: root, concurrency: 2, maxPending: 3, cleanupIntervalMs: 60000, terminalTtlMs: 100, ...options });
  const manager = new DownloadManager(config, metadata, { runner, now: () => clock });
  await manager.initialize();
  t.after(async () => { await manager.close(); await fs.rm(root, { recursive: true, force: true }); });
  const create = (extra = {}, owner = 'owner') => manager.create({ url: info.public.url, optionId: option.id, ...extra }, owner);
  return { manager, calls, root, metadata, create, advance: amount => { clock += amount; } };
}

test('bounded FIFO queue starts all available slots and never exceeds concurrency', async t => {
  const { manager, calls, create } = await fixture(t, { concurrency: 2, maxPending: 2 });
  const jobs = [];
  for (let index = 0; index < 4; index++) jobs.push(await create());
  await until(() => calls.length === 2);
  assert.equal(manager.active.size, 2);
  assert.equal(manager.get(jobs[2].id).queuePosition, 1);
  assert.equal(manager.get(jobs[3].id).queuePosition, 2);
  await assert.rejects(create(), error => error.status === 429);
  await calls[0].finish();
  await until(() => calls.length === 3);
  assert.match(calls[2].tempDir, new RegExp(jobs[2].id));
  assert.equal(manager.active.size, 2);
  await calls[1].finish();
  await until(() => calls.length === 4);
  assert.match(calls[3].tempDir, new RegExp(jobs[3].id));
});

test('cancelled active job retains its slot until stopped; queued cancellation never starts', async t => {
  const { manager, calls, create } = await fixture(t, { concurrency: 1, abortDelay: 80 });
  const first = await create();
  const second = await create();
  const third = await create();
  await until(() => calls.length === 1);
  await manager.cancel(second.id, 'owner');
  assert.equal(manager.get(second.id).status, 'cancelled');
  const cancelling = manager.cancel(first.id, 'owner');
  assert.equal(manager.active.size, 1);
  await assert.rejects(manager.retry(first.id, 'owner'), error => error.status === 409);
  assert.equal(calls.length, 1);
  await cancelling;
  await until(() => calls.length === 2);
  assert.match(calls[1].tempDir, new RegExp(third.id));
  await assert.rejects(fs.access(calls[0].tempDir));
});

test('retry retains the job ID and existing subscriptions, resets progress, and delivers its result', async t => {
  const { manager, calls, create, metadata } = await fixture(t, { concurrency: 1 });
  const job = await create();
  const updates = [];
  manager.events.on(job.id, value => updates.push(value));
  await until(() => calls.length === 1);
  calls[0].onProgress({ progress: 55, downloadedBytes: 55, totalBytes: 100 });
  calls[0].fail(new Error('Transient failure'));
  await until(() => !manager.active.size);
  assert.equal(manager.get(job.id).status, 'failed');
  await assert.rejects(fs.access(calls[0].tempDir));
  const retried = await manager.retry(job.id, 'owner');
  assert.equal(retried.id, job.id);
  assert.equal(retried.attempt, 2);
  assert.equal(retried.progress, 0);
  await until(() => calls.length === 2);
  assert.notEqual(calls[1].tempDir, calls[0].tempDir);
  assert.equal(metadata.requests.at(-1).flags.refresh, true);
  calls[1].onProgress({ progress: 75, downloadedBytes: 75 });
  await calls[1].finish('retry-media');
  await until(() => manager.get(job.id).status === 'completed');
  assert.ok(updates.some(value => value.attempt === 2 && value.progress === 75));
  const record = manager.beginDelivery(job.id, 'owner');
  assert.equal(await fs.readFile(record.filePath, 'utf8'), 'retry-media');
  await manager.finishDelivery(record, true);
  assert.equal(manager.get(job.id).status, 'delivered');
  await assert.rejects(fs.access(calls[1].tempDir));
});

test('active and queued sessions survive terminal TTL; finished files expire and clean up', async t => {
  const { manager, calls, create, advance, metadata } = await fixture(t, { concurrency: 1 });
  const first = await create();
  const queued = await create();
  await until(() => calls.length === 1);
  advance(60 * 60 * 1000);
  await manager.sweep();
  assert.ok(manager.get(first.id));
  assert.ok(manager.get(queued.id));
  assert.ok(manager.hasActive('owner'));
  await calls[0].finish();
  await until(() => calls.length === 2);
  assert.equal(metadata.requests.at(-1).flags.refresh, true, 'long queued jobs refresh expired source URLs');
  const record = manager.beginDelivery(first.id, 'owner');
  advance(1000);
  await manager.sweep();
  assert.ok(manager.get(first.id), 'an in-flight file transfer pins terminal state');
  await manager.finishDelivery(record, false);
  await manager.sweep();
  assert.equal(manager.get(first.id), null);
  await assert.rejects(fs.access(calls[0].tempDir));
  assert.ok(manager.get(queued.id));
});

test('same-title concurrent jobs use unique temporary and native output files', async t => {
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'gsd-save-test-'));
  t.after(() => fs.rm(destination, { recursive: true, force: true }));
  const { manager, calls, create } = await fixture(t, { resolveDestination: token => token === 'native' ? destination : null });
  const first = await create({ saveToken: 'native' });
  const second = await create({ saveToken: 'native' });
  await until(() => calls.length === 2);
  assert.notEqual(calls[0].tempDir, calls[1].tempDir);
  // Concurrent directory creation can finish in either order. Match each runner
  // to its job instead of assuming filesystem callbacks preserve enqueue order.
  const firstCall = calls.find(call => path.basename(call.tempDir).startsWith(`${first.id}-`));
  const secondCall = calls.find(call => path.basename(call.tempDir).startsWith(`${second.id}-`));
  assert.ok(firstCall && secondCall);
  await Promise.all([firstCall.finish('first'), secondCall.finish('second')]);
  await until(() => manager.get(first.id).status === 'completed' && manager.get(second.id).status === 'completed');
  assert.notEqual(manager.get(first.id).savedPath, manager.get(second.id).savedPath);
  assert.equal(await fs.readFile(manager.get(first.id).savedPath, 'utf8'), 'first');
  assert.equal(await fs.readFile(manager.get(second.id).savedPath, 'utf8'), 'second');
  await assert.rejects(fs.access(calls[0].tempDir));
  await assert.rejects(create({ saveToken: '../arbitrary' }), error => error.status === 400);
});

test('manual save acknowledgement retains failed browser writes and handles transfer callback races', async t => {
  const { manager, calls, create } = await fixture(t);
  const job = await create();
  await until(() => calls.length === 1);
  await calls[0].finish('manual');
  await until(() => manager.get(job.id).status === 'completed');
  const record = manager.beginDelivery(job.id, 'owner');
  await manager.finishDelivery(record, false);
  assert.equal(manager.get(job.id).status, 'completed');
  assert.equal(await fs.readFile(record.filePath, 'utf8'), 'manual');
  manager.beginDelivery(job.id, 'owner');
  await manager.acknowledgeDelivery(job.id, 'owner');
  assert.equal(manager.get(job.id).status, 'completed', 'ack waits until a concurrent transfer releases its file');
  await manager.finishDelivery(record, false);
  assert.equal(manager.get(job.id).status, 'delivered');
  assert.equal((await manager.acknowledgeDelivery(job.id, 'owner')).status, 'delivered');
});

test('session ownership prevents access and filenames avoid Windows reserved characters', async t => {
  const { manager, create } = await fixture(t);
  const job = await create();
  assert.throws(() => manager.owned(job.id, 'another-owner'), error => error.status === 404);
  assert.equal(manager.list('another-owner').length, 0);
  assert.equal(safeFilename('CON', 'mp4', '12345678-'), '_CON [12345678].mp4');
  assert.ok(!/[<>:"/\\|?*]/.test(safeFilename('bad?:/name', 'mp4', '12345678')));
});
