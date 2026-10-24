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
const ffmpeg = args => run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
const probe = async file => JSON.parse((await run(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true })).stdout);
async function streamHash(file, selector) {
  return (await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', selector, '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-'], { windowsHide: true })).stdout.trim();
}

async function compareMedia(source, output, { audio = true, video = false } = {}) {
  if (audio) assert.equal(await streamHash(output, '0:a:0'), await streamHash(source, '0:a:0'), 'audio packets are preserved without re-encoding');
  if (video) assert.equal(await streamHash(output, '0:v:0'), await streamHash(source, '0:v:0'), 'video packets are preserved without re-encoding');
  const [before, after] = await Promise.all([probe(source), probe(output)]);
  const normalizeTags = value => Object.fromEntries(Object.entries(value || {}).map(([key, content]) => [key.toLowerCase(), content]));
  const beforeTags = normalizeTags(before.format.tags), afterTags = normalizeTags(after.format.tags);
  for (const tag of ['title', 'artist', 'album', 'comment']) assert.equal(afterTags[tag], beforeTags[tag], `existing ${tag} metadata is preserved`);
  assert.ok(Math.abs(Number(after.format.duration) - Number(before.format.duration)) < 0.1, 'duration is preserved');
  return after;
}

async function main() {
  await fs.mkdir(work, { recursive: true });
  const fixture = path.join(work, 'GSD-fixture.mp4');
  const tags = ['-metadata', 'title=GSD source title', '-metadata', 'artist=GSD fixture artist', '-metadata', 'album=GSD fixture album', '-metadata', 'comment=Keep existing metadata'];
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xaccb55:s=320x180:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ...tags, '-movflags', '+faststart', fixture]);
  const assets = new Map();
  assets.set('source.mp4', { file: fixture, type: 'video/mp4' });
  for (const [name, args, type] of [
    ['source.m4a', ['-i', fixture, '-vn', '-c:a', 'copy', ...tags], 'audio/mp4'],
    ['source.mp3', ['-i', fixture, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', ...tags], 'audio/mpeg'],
    ['source.mkv', ['-i', fixture, '-c', 'copy', ...tags], 'video/x-matroska'],
    ['source.webm', ['-i', fixture, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-c:a', 'libopus', ...tags], 'video/webm'],
    ['cover.webp', ['-f', 'lavfi', '-i', 'color=c=0x6495ed:s=640x360', '-frames:v', '1', '-c:v', 'libwebp'], 'image/webp'],
    ['small.png', ['-f', 'lavfi', '-i', 'color=c=0xdc143c:s=160x90', '-frames:v', '1'], 'image/png'],
  ]) {
    const file = path.join(work, name);
    await ffmpeg([...args, file]);
    assets.set(name, { file, type });
  }
  for (const asset of assets.values()) asset.bytes = await fs.readFile(asset.file);
  const original = await fs.readFile(fixture);
  let throttled = false;
  let mediaRequests = 0;
  const imageRequests = new Map();
  const source = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture.invalid').pathname;
    if (pathname.startsWith('/pages/')) {
      const name = pathname.slice('/pages/'.length);
      const extension = ['mp3', 'm4a', 'webm', 'mkv'].includes(name) ? name : 'mp4';
      const tag = ['mp3', 'm4a'].includes(extension) ? 'audio' : 'video';
      const image = name === 'missing' ? '' : name === 'corrupt' ? '/art/corrupt.webp' : name === 'cancel' ? '/art/slow.webp' : '/art/cover.webp';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><head><title>GSD artwork ${name}</title>${image ? `<meta property="og:image" content="${image}">` : ''}</head><body><${tag} controls ${image ? `poster="${image}"` : ''} src="/assets/source.${extension}"></${tag}></body></html>`);
    }
    if (pathname.startsWith('/art/')) {
      if (req.method !== 'HEAD') imageRequests.set(pathname, (imageRequests.get(pathname) || 0) + 1);
      if (pathname === '/art/corrupt.webp') {
        const bytes = Buffer.from('This intentionally is not an image.');
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      const asset = assets.get(pathname.endsWith('small.png') ? 'small.png' : 'cover.webp');
      res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.bytes.length });
      if (req.method === 'HEAD') return res.end();
      if (pathname === '/art/slow.webp') {
        let offset = 0;
        const timer = setInterval(() => {
          const end = Math.min(offset + 8, asset.bytes.length);
          res.write(asset.bytes.subarray(offset, end)); offset = end;
          if (offset >= asset.bytes.length) { clearInterval(timer); res.end(); }
        }, 100);
        res.on('close', () => clearInterval(timer));
        return;
      }
      return res.end(asset.bytes);
    }
    if (pathname.startsWith('/assets/')) {
      const asset = assets.get(pathname.slice('/assets/'.length));
      if (!asset) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.bytes.length });
      return res.end(req.method === 'HEAD' ? undefined : asset.bytes);
    }
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
  const processingEvents = [];
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
    backend.manager.events.on('change', (_owner, job) => processingEvents.push({ id: job.id, status: job.status, stage: job.stage }));
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
    assert.equal((await probe(musicPath)).streams[0].codec_name, 'mp3');
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

    // HTML5 fixtures exercise the actual yt-dlp metadata/thumbnail cache and all
    // native processors, rather than depending on an external provider's media.
    const base = `http://127.0.0.1:${source.address().port}`;
    const pageInfo = Object.fromEntries(await Promise.all(['mp3', 'm4a', 'mp4', 'webm', 'mkv', 'missing', 'corrupt', 'cancel'].map(async name => [name, await json('/api/info', { url: `${base}/pages/${name}` })])));
    const optionFor = (name, format = name) => {
      const option = pageInfo[name].options.find(option => option.format === format && option.type === (['mp3', 'm4a'].includes(format) ? 'audio' : 'video'));
      assert.ok(option, `${name} source offers ${format}`);
      return option;
    };
    const createArtworkJob = (name, settings = {}, format = name) => json('/api/jobs', { url: pageInfo[name].url, optionId: optionFor(name, format).id, ...settings });
    const artifact = async (job, name) => {
      const response = await request(`/api/jobs/${job.id}/file`, undefined, { 'X-GSD-Delivery-Ack': 'manual' });
      assert.ok(response.ok, `deliver ${name}`);
      const file = path.join(work, `artwork-${name}`);
      await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
      return file;
    };
    const expectCover = info => {
      const cover = info.streams.find(stream => stream.disposition?.attached_pic === 1);
      assert.ok(cover, 'cover artwork is an attached picture');
      assert.ok(['mjpeg', 'png'].includes(cover.codec_name), 'cover uses a compatible JPEG or PNG codec');
      assert.equal(cover.width, 640, 'highest quality artwork dimensions preserved');
      assert.equal(cover.height, 360, 'artwork aspect ratio preserved');
    };
    for (const name of ['mp3', 'm4a', 'mp4', 'mkv']) assert.equal(optionFor(name).thumbnailSupport.supported, true, `${name} advertises artwork support`);
    assert.equal(optionFor('webm').thumbnailSupport.supported, false, 'WebM advertises its container limitation');

    // Deliberately place the low-resolution fallback last: choosing the last
    // thumbnail or raw.thumbnail would produce the wrong dimensions.
    const cachedMp4 = await backend.metadata.get(pageInfo.mp4.url);
    cachedMp4.raw.thumbnails = [{ url: `${base}/art/cover.webp`, width: 640, height: 360 }, { url: `${base}/art/small.png`, width: 160, height: 90 }];
    cachedMp4.raw.thumbnail = `${base}/art/small.png`;
    const embedded = await Promise.all(['mp3', 'm4a', 'mp4', 'mkv'].map(async name => {
      const created = await createArtworkJob(name);
      const job = await finish(created.id);
      assert.equal(job.thumbnailEmbedded, true, `${name} embedding completes before the job completes`);
      assert.deepEqual(job.warnings, [], `${name} embeds without warnings`);
      const file = await artifact(job, `embedded.${name}`);
      const inspected = await compareMedia(assets.get(`source.${name}`).file, file, { video: ['mp4', 'mkv'].includes(name) });
      if (name === 'mkv') {
        const attachment = inspected.streams.find(stream => stream.codec_type === 'attachment' || stream.disposition?.attached_pic === 1);
        assert.ok(attachment, 'MKV stores a cover attachment');
        assert.match(attachment.tags?.filename || '', /^cover\.(jpe?g|png)$/i, 'MKV cover has a recognized attachment filename');
        assert.match(attachment.tags?.mimetype || '', /^image\/(jpeg|png)$/i);
      } else expectCover(inspected);
      const stages = processingEvents.filter(event => event.id === job.id);
      assert.ok(stages.some(event => event.stage === 'processing_thumbnail' && event.status === 'processing'), 'thumbnail preparation is a processing stage');
      assert.ok(stages.some(event => event.stage === 'embedding_thumbnail' && event.status === 'processing'), 'embedding is a processing stage');
      assert.ok(stages.some(event => event.stage === 'finalizing'), 'finalization is reported');
      assert.equal(stages.at(-1).status, 'completed', 'completion follows every processing stage');
      const temporary = backend.manager.getRecord(job.id).tempDir;
      assert.ok((await fs.readdir(temporary)).every(name => !/thumbnail|cover|artwork|embedding/i.test(name)), 'temporary artwork and embedding files removed after success');
      await json(`/api/jobs/${job.id}/delivered`, {});
      return { format: name, file, streams: inspected.streams.map(stream => ({ codec: stream.codec_name, type: stream.codec_type, attached: stream.disposition?.attached_pic || 0 })) };
    }));
    assert.equal(imageRequests.get('/art/small.png') || 0, 0, 'lower resolution fallback was never requested');

    const convertedMp3 = await finish((await createArtworkJob('mp4', {}, 'mp3')).id);
    assert.equal(convertedMp3.thumbnailEmbedded, true, 'MP3 conversion also embeds artwork');
    const convertedMp3Info = await compareMedia(musicPath, await artifact(convertedMp3, 'converted.mp3'));
    expectCover(convertedMp3Info);
    assert.ok(processingEvents.some(event => event.id === convertedMp3.id && event.stage === 'converting_audio'), 'audio conversion stage is reported');
    await json(`/api/jobs/${convertedMp3.id}/delivered`, {});

    const beforeDisabled = [...imageRequests.values()].reduce((sum, count) => sum + count, 0);
    const disabled = await finish((await createArtworkJob('mp4', { embedThumbnail: false })).id);
    assert.equal(disabled.thumbnailEmbedded, false);
    assert.deepEqual(disabled.warnings, []);
    assert.equal([...imageRequests.values()].reduce((sum, count) => sum + count, 0), beforeDisabled, 'turning artwork off causes no image download');
    assert.equal(sha(await fs.readFile(await artifact(disabled, 'disabled.mp4'))), sha(original), 'disabled artwork retains exact source bytes');
    await json(`/api/jobs/${disabled.id}/delivered`, {});

    for (const name of ['missing', 'corrupt']) {
      const job = await finish((await createArtworkJob(name, {}, 'mp4')).id);
      assert.equal(job.thumbnailEmbedded, false, `${name} artwork is nonfatal`);
      assert.ok(job.warnings.length > 0, `${name} artwork reports a nonfatal warning`);
      assert.equal(sha(await fs.readFile(await artifact(job, `${name}.mp4`))), sha(original), `${name} artwork preserves the successful media download`);
      await json(`/api/jobs/${job.id}/delivered`, {});
    }

    const beforeUnsupported = imageRequests.get('/art/cover.webp') || 0;
    const unsupported = await finish((await createArtworkJob('webm')).id);
    assert.equal(unsupported.thumbnailEmbedded, false);
    assert.ok(unsupported.warnings.length > 0, 'unsupported automatic embedding warns without conversion');
    assert.equal(imageRequests.get('/art/cover.webp') || 0, beforeUnsupported, 'unsupported container does not fetch unused artwork');
    assert.equal(sha(await fs.readFile(await artifact(unsupported, 'unsupported.webm'))), sha(assets.get('source.webm').bytes), 'unsupported WebM remains byte-identical');
    await json(`/api/jobs/${unsupported.id}/delivered`, {});

    const sidecar = await finish((await createArtworkJob('webm', { thumbnailSidecar: true })).id);
    assert.ok(sidecar.sidecarFilename && /\.(jpe?g|png)$/i.test(sidecar.sidecarFilename));
    for (const kind of ['file', 'thumbnail']) {
      const head = await fetch(`${backend.url}/api/jobs/${sidecar.id}/${kind}`, { method: 'HEAD', headers: { Cookie: cookie } });
      assert.equal(head.status, 200, `${kind} HEAD exposes the download headers`);
      await delay(50);
      const retained = await json(`/api/jobs/${sidecar.id}`);
      assert.equal(retained.status, 'completed', `${kind} HEAD does not acknowledge main-file delivery`);
      assert.equal(retained.sidecarDelivered, false, `${kind} HEAD does not acknowledge sidecar delivery`);
    }
    assert.equal(sha(await fs.readFile(await artifact(sidecar, 'sidecar.webm'))), sha(assets.get('source.webm').bytes));
    await json(`/api/jobs/${sidecar.id}/delivered`, {});
    assert.equal((await json(`/api/jobs/${sidecar.id}`)).status, 'delivered');
    assert.ok(backend.manager.getRecord(sidecar.id).tempDir, 'sidecar survives main-file acknowledgment');
    assert.equal((await fetch(`${backend.url}/api/jobs/${sidecar.id}/thumbnail`)).status, 404, 'thumbnail ownership is enforced');
    const sidecarResponse = await request(`/api/jobs/${sidecar.id}/thumbnail`);
    assert.ok(sidecarResponse.ok, 'sidecar is independently downloadable after main file');
    const sidecarFile = path.join(work, 'verified-sidecar' + path.extname(sidecar.sidecarFilename));
    await fs.writeFile(sidecarFile, Buffer.from(await sidecarResponse.arrayBuffer()));
    const sidecarProbe = await probe(sidecarFile);
    assert.equal(sidecarProbe.streams[0].width, 640);
    assert.equal(sidecarProbe.streams[0].height, 360);
    const sidecarDeadline = Date.now() + 5000;
    while (!backend.manager.getRecord(sidecar.id).sidecarDelivered && Date.now() < sidecarDeadline) await delay(25);
    assert.equal(backend.manager.getRecord(sidecar.id).sidecarDelivered, true, 'sidecar transfer acknowledgment recorded');
    assert.equal(backend.manager.getRecord(sidecar.id).tempDir, null, 'both deliveries clean all temporary files');

    const desktopSidecar = await finish((await createArtworkJob('webm', { thumbnailSidecar: true, saveToken: 'fixture-directory' })).id);
    assert.ok(desktopSidecar.savedPath && desktopSidecar.sidecarSavedPath, 'native folder receives media and artwork');
    assert.equal(path.parse(desktopSidecar.savedPath).name, path.parse(desktopSidecar.sidecarSavedPath).name, 'native sidecar shares the media filename stem');
    assert.equal(sha(await fs.readFile(desktopSidecar.savedPath)), sha(assets.get('source.webm').bytes));
    assert.equal((await probe(desktopSidecar.sidecarSavedPath)).streams[0].width, 640);
    assert.equal(backend.manager.getRecord(desktopSidecar.id).tempDir, null);

    const cancellation = await createArtworkJob('cancel', {}, 'mp4');
    const artworkDeadline = Date.now() + 30_000;
    while (!(imageRequests.get('/art/slow.webp') > 0) && Date.now() < artworkDeadline) await delay(25);
    assert.ok(imageRequests.get('/art/slow.webp') > 0, 'real thumbnail retrieval started before cancellation');
    const duringProcessing = await json(`/api/jobs/${cancellation.id}`);
    assert.equal(duringProcessing.status, 'processing');
    const stopped = await json(`/api/jobs/${cancellation.id}/cancel`, {});
    assert.equal(stopped.status, 'cancelled');
    assert.equal(backend.manager.active.has(cancellation.id), false, 'cancellation waits for thumbnail process termination');
    assert.equal(backend.manager.getRecord(cancellation.id).tempDir, null, 'processing cancellation cleans media and thumbnail artifacts');

    const summary = { ok: true, date: new Date().toISOString(), checks: ['real yt-dlp metadata', 'FFprobe stream enrichment', 'concurrent MP4 and MP3 jobs', 'SSE completion', 'MP4 byte-for-byte source preservation', 'browser manual save acknowledgment', 'MP3 codec verified by FFprobe', 'two concurrent native directory saves with collision avoidance', 'existing destination preserved', 'session ownership', 'cross-origin rejection', 'real bounded FIFO queue', 'queued cancellation', 'active Windows yt-dlp process cancellation and cleanup', 'same-ID retry with refreshed metadata and file delivery', 'one owner-wide SSE stream through retry', 'real HTML5 thumbnail extraction reused by downloads', 'native MP3 ID3, M4A/MP4 attached covers and MKV cover attachments', 'MP3 conversion plus artwork preserves the original conversion audio packet hash', 'all original audio/video packet hashes, duration and title/artist/album/comment preserved', 'highest resolution WebP artwork converted without aspect-ratio loss', 'thumbnail/embedding/finalization stages precede completion', 'temporary artwork cleanup', 'disabled artwork issues no image request', 'missing and corrupt artwork preserve media with nonfatal warnings', 'WebM limitation without container conversion', 'optional browser sidecar survives main delivery and enforces ownership', 'native sidecar copied beside media with matching stem', 'real thumbnail-processing cancellation and cleanup'], tools: health.tools, formats: info.options, artwork: embedded, progressEvents: events.length, queueEvents: queueEvents.length, processingEvents: processingEvents.length };
    await fs.writeFile(path.join(work, 'result.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await backend?.close();
    source.closeAllConnections?.();
    await new Promise(resolve => source.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
