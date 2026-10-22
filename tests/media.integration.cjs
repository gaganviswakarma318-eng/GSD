/* Real executable integration: only generated local media, no third-party content. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { startServer } = require('../backend/server');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const work = path.join(root, 'work', 'media-integration');
const tools = Object.fromEntries([['ytDlp', 'yt-dlp'], ['ffmpeg', 'ffmpeg'], ['ffprobe', 'ffprobe'], ['node', 'node']].map(([key, name]) => [key, path.join(root, 'backend', 'binaries', `${name}.exe`)]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  await fs.mkdir(work, { recursive: true });
  const fixture = path.join(work, 'GSD-fixture.mp4');
  await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xaccb55:s=320x180:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true });
  const original = await fs.readFile(fixture);
  let throttled = false;
  let mediaRequests = 0;
  const source = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': original.length });
    if (req.method === 'HEAD') return res.end();
    mediaRequests++;
    if (throttled) {
      let offset = 0;
      const timer = setInterval(() => {
        const end = throttled ? Math.min(offset + 512, original.length) : original.length;
        res.write(original.subarray(offset, end)); offset = end;
        if (offset >= original.length) { clearInterval(timer); res.end(); }
      }, 100);
      res.on('close', () => clearInterval(timer));
      return;
    }
    createReadStream(fixture).pipe(res);
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const mediaUrl = `http://127.0.0.1:${source.address().port}/GSD-fixture.mp4`;
  let backend;
  let cookie = '';
  const events = [];
  const request = async (endpoint, body, extraHeaders = {}) => {
    const response = await fetch(`${backend.url}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    return response;
  };
  const json = async (endpoint, body) => {
    const response = await request(endpoint, body);
    const result = await response.json();
    assert.ok(response.ok, `${endpoint}: ${JSON.stringify(result)}`);
    return result;
  };
  const finish = async id => {
    const end = Date.now() + 90_000;
    while (Date.now() < end) {
      const job = await json(`/api/jobs/${id}`);
      if (job.status === 'failed') assert.fail(job.error);
      if (job.status === 'completed') return job;
      await delay(150);
    }
    assert.fail(`Job ${id} did not finish`);
  };
  try {
    backend = await startServer({ port: 0, allowPrivateUrls: true, tempRoot: path.join(work, 'jobs'), tools, resolveDestination: token => token === 'fixture-directory' ? path.join(work, 'saved') : null });
    const health = await json('/api/health');
    assert.ok(health.tools.ytDlp && health.tools.ffmpeg && health.tools.ffprobe && health.tools.node);
    const info = await json('/api/info', { url: mediaUrl });
    const videoOption = info.options.find(option => option.type === 'video' && option.format === 'mp4');
    const audioOption = info.options.find(option => option.type === 'audio' && option.format === 'mp3');
    assert.ok(videoOption, 'actual MP4 source option');
    assert.ok(audioOption, 'MP3 conversion option when FFprobe finds audio');
    const [video, audio] = await Promise.all([
      json('/api/jobs', { url: mediaUrl, optionId: videoOption.id }),
      json('/api/jobs', { url: mediaUrl, optionId: audioOption.id }),
    ]);
    const controller = new AbortController();
    const sse = await fetch(`${backend.url}/api/jobs/${audio.id}/events`, { headers: { Cookie: cookie }, signal: controller.signal });
    assert.equal(sse.headers.get('content-type')?.split(';')[0], 'text/event-stream');
    const observe = (async () => {
      try { for await (const chunk of sse.body) events.push(Buffer.from(chunk).toString()); } catch (error) { if (error.name !== 'AbortError') throw error; }
    })();
    await Promise.all([finish(video.id), finish(audio.id)]);
    controller.abort();
    await observe;
    assert.ok(events.join('').includes('"status":"completed"'), 'SSE completion observed');
    const media = await request(`/api/jobs/${video.id}/file`, undefined, { 'X-GSD-Delivery-Ack': 'manual' });
    assert.ok(media.ok);
    const savedVideo = Buffer.from(await media.arrayBuffer());
    assert.equal(sha(savedVideo), sha(original), 'native MP4 avoids transcoding');
    assert.equal((await json(`/api/jobs/${video.id}`)).status, 'completed', 'manual delivery retained before acknowledgment');
    await json(`/api/jobs/${video.id}/delivered`, {});
    assert.equal((await json(`/api/jobs/${video.id}`)).status, 'delivered');
    const music = await request(`/api/jobs/${audio.id}/file`);
    assert.ok(music.ok);
    const musicPath = path.join(work, 'verified.mp3');
    await fs.writeFile(musicPath, Buffer.from(await music.arrayBuffer()));
    const probe = await run(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'json', musicPath], { windowsHide: true });
    assert.equal(JSON.parse(probe.stdout).streams[0].codec_name, 'mp3');
    await fs.mkdir(path.join(work, 'saved'), { recursive: true });
    const sentinel = path.join(work, 'saved', 'GSD-fixture.mp4');
    await fs.writeFile(sentinel, 'Existing file must be preserved');
    const [desktop1, desktop2] = await Promise.all([1, 2].map(() => json('/api/jobs', { url: mediaUrl, optionId: videoOption.id, saveToken: 'fixture-directory' })));
    const results = await Promise.all([finish(desktop1.id), finish(desktop2.id)]);
    assert.ok(results.every(job => job.savedPath));
    assert.notEqual(results[0].savedPath, results[1].savedPath);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'Existing file must be preserved');
    for (const job of results) assert.equal(sha(await fs.readFile(job.savedPath)), sha(original));
    const unauthenticated = await fetch(`${backend.url}/api/jobs/${video.id}`);
    assert.equal(unauthenticated.status, 404);
    const crossSite = await request('/api/jobs', { url: mediaUrl, optionId: videoOption.id }, { Origin: 'https://example.com' });
    assert.equal(crossSite.status, 403);
    const queueController = new AbortController();
    const queueStream = await fetch(`${backend.url}/api/events`, { headers: { Cookie: cookie }, signal: queueController.signal });
    const queueEvents = [];
    const queueObserver = (async () => {
      try { for await (const chunk of queueStream.body) queueEvents.push(Buffer.from(chunk).toString()); } catch (error) { if (error.name !== 'AbortError') throw error; }
    })();
    throttled = true;
    const before = mediaRequests;
    const [toCancel, other, waiting] = await Promise.all([1, 2, 3].map(() => json('/api/jobs', { url: mediaUrl, optionId: videoOption.id })));
    assert.equal(waiting.status, 'queued');
    assert.equal(waiting.queuePosition, 1);
    const timeout = Date.now() + 20_000;
    while (mediaRequests < before + 2 && Date.now() < timeout) await delay(100);
    assert.ok(mediaRequests >= before + 2, 'both real downloads started');
    const cancelledWaiting = await json(`/api/jobs/${waiting.id}/cancel`, {});
    assert.equal(cancelledWaiting.status, 'cancelled');
    const cancelled = await json(`/api/jobs/${toCancel.id}/cancel`, {});
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(backend.manager.active.has(toCancel.id), false, 'cancel response waits for stopped process');
    const cancelledRecord = backend.manager.getRecord(toCancel.id);
    assert.equal(cancelledRecord.tempDir, null, 'cancelled attempt cleaned');
    throttled = false;
    const retried = await json(`/api/jobs/${toCancel.id}/retry`, {});
    assert.equal(retried.id, toCancel.id);
    assert.equal(retried.attempt, 2);
    await Promise.all([finish(retried.id), finish(other.id)]);
    const retriedResponse = await request(`/api/jobs/${retried.id}/file`);
    assert.ok(retriedResponse.ok);
    assert.equal(sha(Buffer.from(await retriedResponse.arrayBuffer())), sha(original), 'retry file delivery works');
    queueController.abort(); await queueObserver;
    const snapshots = queueEvents.join('');
    assert.ok(snapshots.includes('"attempt":2') && snapshots.includes('"status":"cancelled"') && snapshots.includes('"status":"completed"'), 'one owner stream covers queue, cancellation, retry, and completion');
    const summary = { ok: true, date: new Date().toISOString(), checks: ['real yt-dlp metadata', 'FFprobe stream enrichment', 'concurrent MP4 and MP3 jobs', 'SSE completion', 'MP4 byte-for-byte source preservation', 'browser manual save acknowledgment', 'MP3 codec verified by FFprobe', 'two concurrent native directory saves with collision avoidance', 'existing destination preserved', 'session ownership', 'cross-origin rejection', 'real bounded FIFO queue', 'queued cancellation', 'active Windows yt-dlp process cancellation and cleanup', 'same-ID retry with refreshed metadata and file delivery', 'one owner-wide SSE stream through retry'], tools: health.tools, formats: info.options, progressEvents: events.length, queueEvents: queueEvents.length };
    await fs.writeFile(path.join(work, 'result.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await backend?.close();
    source.closeAllConnections?.();
    await new Promise(resolve => source.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
