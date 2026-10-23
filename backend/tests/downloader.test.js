const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runDownload, parseProgress } = require('../services/downloader');

async function progressFixture(t, { option, raw = {}, ticks }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gsd-progress-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const events = [];
  await runDownload({
    config: { tools: { ytDlp: 'fixture', node: process.execPath } },
    raw,
    option,
    tempDir,
    onProgress: event => events.push(event),
    processRunner: async (command, args, { onLine }) => {
      for (const tick of ticks) onLine(typeof tick === 'string' ? tick : 'GSD_PROGRESS:' + JSON.stringify(tick));
      const filePath = path.join(tempDir, 'media.mp4');
      await fs.writeFile(filePath, 'fixture media');
      onLine('GSD_FILE:' + JSON.stringify(filePath));
      return { code: 0, stderr: '' };
    },
  });
  return events;
}

test('unavailable total bytes produce indeterminate progress', () => {
  const progress = parseProgress('GSD_PROGRESS:{"downloaded_bytes":50,"total_bytes":0,"total_bytes_estimate":0,"format_id":"v","status":"downloading"}');
  assert.equal(progress.downloadedBytes, 50);
  assert.equal(progress.totalBytes, null);
  assert.equal(progress.progress, 0);
});

test('measured stream totals replace stale metadata size estimates', async t => {
  const events = await progressFixture(t, {
    option: { selector: 'v', estimatedSize: 1000 },
    raw: { formats: [{ format_id: 'v', filesize_approx: 1000 }] },
    ticks: [
      { downloaded_bytes: 50, total_bytes: 100, format_id: 'v', status: 'downloading' },
      { downloaded_bytes: 100, total_bytes: 100, format_id: 'v', status: 'finished' },
    ],
  });
  assert.deepEqual(events.map(event => event.totalBytes), [100, 100]);
  assert.deepEqual(events.map(event => event.progress), [50, 99]);
});

test('unknown totals do not report a fabricated zero-second ETA', async t => {
  const [event] = await progressFixture(t, {
    option: { selector: 'v' },
    ticks: [{ downloaded_bytes: 50, total_bytes: 0, total_bytes_estimate: 0, eta: 0, speed: 25, format_id: 'v', status: 'downloading' }],
  });
  assert.equal(event.totalBytes, null);
  assert.equal(event.etaSeconds, null);
  assert.equal(event.speedBytes, 25);
  assert.equal(event.downloadedBytes, 50);
});

test('merged progress waits for every stream total and retains completed stream bytes', async t => {
  const events = await progressFixture(t, {
    option: { selector: 'v+a', merged: true, format: 'mp4' },
    ticks: [
      { downloaded_bytes: 50, total_bytes: 100, format_id: 'v', status: 'downloading' },
      { downloaded_bytes: 100, total_bytes: 100, format_id: 'v', status: 'finished' },
      { downloaded_bytes: 10, total_bytes: 20, format_id: 'a', status: 'downloading' },
      { downloaded_bytes: 20, total_bytes: 20, format_id: 'a', status: 'finished' },
      'GSD_PROCESSING:started',
    ],
  });
  assert.deepEqual(events.slice(0, 2).map(event => [event.progress, event.totalBytes]), [[0, null], [0, null]]);
  assert.equal(events[2].downloadedBytes, 110);
  assert.equal(events[2].totalBytes, 120);
  assert.ok(Math.abs(events[2].progress - 110 / 120 * 100) < 1e-9);
  assert.equal(events[3].downloadedBytes, 120);
  assert.equal(events[3].progress, 99);
  assert.equal(events[4].status, 'processing');
  assert.equal(events[4].speedBytes, null);
  assert.equal(events[4].etaSeconds, null);
});

test('merged progress combines selected stream metadata and updates each measured total', async t => {
  const events = await progressFixture(t, {
    option: { selector: 'v+a', merged: true, format: 'mp4', estimatedSize: 1500 },
    raw: { formats: [{ format_id: 'v', filesize_approx: 1000 }, { format_id: 'a', filesize: 500 }, { format_id: 'unused', filesize: 9000 }] },
    ticks: [
      { downloaded_bytes: 50, total_bytes: 100, format_id: 'v', status: 'downloading' },
      { downloaded_bytes: 100, total_bytes: 100, format_id: 'v', status: 'finished' },
      { downloaded_bytes: 10, total_bytes: 20, format_id: 'a', status: 'downloading' },
    ],
  });
  assert.equal(events[0].totalBytes, 600);
  assert.ok(Math.abs(events[0].progress - 50 / 600 * 100) < 1e-9);
  assert.equal(events[1].totalBytes, 600);
  assert.equal(events[2].totalBytes, 120);
  assert.equal(events[2].downloadedBytes, 110);
});

test('a finished stream replaces an approximate size with its actual downloaded bytes', async t => {
  const events = await progressFixture(t, {
    option: { selector: 'v+a', merged: true, format: 'mp4', estimatedSize: 1100 },
    raw: { formats: [{ format_id: 'v', filesize_approx: 1000 }, { format_id: 'a', filesize: 100 }] },
    ticks: [
      { downloaded_bytes: 80, total_bytes_estimate: 1000, format_id: 'v', status: 'downloading' },
      { downloaded_bytes: 100, total_bytes_estimate: 1000, format_id: 'v', status: 'finished' },
    ],
  });
  assert.equal(events[0].totalBytes, 1100);
  assert.equal(events[1].totalBytes, 200);
  assert.equal(events[1].downloadedBytes, 100);
  assert.equal(events[1].progress, 50);
});

test('finished stream sizes persist when later progress updates omit total bytes', async t => {
  const events = await progressFixture(t, {
    option: { selector: 'v+a', merged: true, format: 'mp4', estimatedSize: 1020 },
    raw: { formats: [{ format_id: 'v', filesize_approx: 1000 }, { format_id: 'a', filesize: 20 }] },
    ticks: [
      { downloaded_bytes: 100, total_bytes_estimate: 1000, format_id: 'v', status: 'finished' },
      { downloaded_bytes: 10, total_bytes: 0, total_bytes_estimate: 0, format_id: 'a', status: 'downloading' },
    ],
  });
  assert.equal(events[1].totalBytes, 120);
  assert.equal(events[1].downloadedBytes, 110);
  assert.ok(Math.abs(events[1].progress - 110 / 120 * 100) < 1e-9);
});
