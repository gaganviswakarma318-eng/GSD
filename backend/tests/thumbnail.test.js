const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { thumbnailSupport, processThumbnail } = require('../services/thumbnail');

const jpeg = Buffer.from([255, 216, 255, 224, 0, 1, 2, 3, 255, 217]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const audioStream = { index: 0, codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 };
const coverStream = { index: 1, codec_type: 'video', codec_name: 'mjpeg', width: 1280, height: 720, disposition: { attached_pic: 1 } };

async function fixture(t, { format = 'mp3', fail, originalTags = {}, imageBytes = jpeg, imageCodec = 'mjpeg' } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gsd-artwork-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const filePath = path.join(tempDir, `media.${format}`);
  const infoPath = path.join(tempDir, 'source.info.json');
  await fs.writeFile(filePath, 'original media bytes');
  await fs.writeFile(infoPath, '{}');
  const calls = [];
  const events = [];
  const original = { streams: [audioStream], format: { duration: '3.0', tags: originalTags } };
  const image = { streams: [{ index: 0, codec_type: 'video', codec_name: imageCodec, width: 1280, height: 720 }], format: { format_name: `${imageCodec === 'mjpeg' ? 'jpeg' : imageCodec}_pipe` } };
  const processRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    const operation = command === 'yt-dlp' ? 'download' : command === 'ffprobe'
      ? args.at(-1) === filePath ? 'probe_original' : args.at(-1).includes('.artwork-') ? 'probe_result' : 'probe_image'
      : args.includes('null') ? 'validate_image' : args.includes('image2') ? 'convert_image' : 'embed';
    if (fail) {
      const outcome = await fail(operation, { command, args, options });
      if (outcome) return outcome;
    }
    if (operation === 'download') {
      const directory = args[args.indexOf('--paths') + 1];
      await fs.writeFile(path.join(directory, 'cover.webp'), imageBytes);
    }
    if (operation.startsWith('probe_')) {
      const value = operation === 'probe_original' ? original : operation === 'probe_result'
        ? { streams: [...original.streams, format === 'mkv' ? { ...coverStream, tags: { filename: 'cover.jpg', mimetype: 'image/jpeg' } } : coverStream], format: original.format }
        : args.at(-1).endsWith('artwork.png') ? { ...image, streams: [{ ...image.streams[0], codec_name: 'png' }] } : image;
      return { code: 0, stdout: JSON.stringify(value), stderr: '' };
    }
    if (operation === 'embed') await fs.writeFile(args.at(-1), 'media with cover artwork');
    if (operation === 'convert_image') await fs.writeFile(args.at(-1), png);
    return { code: 0, stdout: '', stderr: '' };
  };
  const run = extra => processThumbnail({
    config: { tools: { ytDlp: 'yt-dlp', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', node: process.execPath } },
    raw: { title: 'Source title', track: 'Track title', artist: 'Source artist', album: 'Source album', thumbnail: 'https://example.com/cover.webp' },
    option: { format }, filePath, infoPath, tempDir, processRunner, onProgress: value => events.push(value), ...extra,
  });
  return { tempDir, filePath, infoPath, calls, events, run };
}

async function assertClean(context) {
  assert.deepEqual((await fs.readdir(context.tempDir)).filter(value => value.startsWith('thumbnail-') || value.startsWith('.artwork-')), []);
}

test('container support distinguishes attached pictures, Matroska covers, and unsupported formats', () => {
  for (const format of ['mp3', 'm4a', 'm4b', 'mp4', 'm4v', 'flac', 'mkv', 'mka']) assert.equal(thumbnailSupport(format).supported, true, format);
  assert.equal(thumbnailSupport('MKV').method, 'matroska');
  for (const format of ['webm', 'wav', 'aac', 'avi', 'mov']) assert.equal(thumbnailSupport(format).supported, false, format);
});

test('disabled artwork does no work; missing source artwork is a nonfatal warning', async t => {
  const context = await fixture(t);
  assert.deepEqual(await context.run({ embedThumbnail: false }), { embedded: false, warnings: [] });
  assert.equal(context.calls.length, 0);
  const result = await context.run({ raw: {} });
  assert.equal(result.embedded, false);
  assert.match(result.warnings[0], /No thumbnail/);
  assert.equal(context.calls.length, 0);
  assert.equal(await fs.readFile(context.filePath, 'utf8'), 'original media bytes');
});

test('MP3 artwork uses cached info, preserves source image bytes and existing tags, commits only after validation', async t => {
  const context = await fixture(t, { originalTags: { title: 'Original title', ARTIST: 'Original artist', album: 'Original album' } });
  const result = await context.run();
  assert.equal(result.embedded, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(await fs.readFile(context.filePath, 'utf8'), 'media with cover artwork');
  const download = context.calls.find(call => call.command === 'yt-dlp');
  assert.ok(download.args.includes('--skip-download') && download.args.includes('--write-thumbnail'));
  assert.equal(download.args[download.args.indexOf('--load-info-json') + 1], context.infoPath);
  assert.ok(!download.args.includes('--write-all-thumbnails'));
  const embed = context.calls.find(call => call.args.includes('-id3v2_version'));
  assert.equal(embed.args[embed.args.indexOf('-id3v2_version') + 1], '3');
  assert.ok(embed.args.includes('attached_pic'));
  assert.ok(embed.args.includes('copy'));
  assert.ok(embed.args.includes('-map_metadata') && embed.args.includes('-map_chapters'));
  assert.ok(!embed.args.includes('title=Track title') && !embed.args.includes('artist=Source artist') && !embed.args.includes('album=Source album'));
  assert.ok(!context.calls.some(call => call.args.includes('image2')), 'JPEG is never re-encoded');
  assert.deepEqual(context.events.map(event => event.stage), ['processing_thumbnail', 'embedding_thumbnail']);
  await assertClean(context);
});

test('M4A/MP4 use attached artwork; Matroska uses a typed cover attachment', async t => {
  for (const format of ['m4a', 'mp4', 'mkv']) {
    const context = await fixture(t, { format });
    assert.equal((await context.run()).embedded, true, format);
    const embed = context.calls.find(call => call.command === 'ffmpeg' && call.args.at(-1).includes('.artwork-'));
    if (format === 'mkv') {
      assert.ok(embed.args.includes('-attach'));
      assert.ok(embed.args.includes('filename=cover.jpg') && embed.args.includes('mimetype=image/jpeg'));
      assert.ok(!embed.args.includes('attached_pic'));
    } else {
      assert.ok(embed.args.includes('attached_pic') && embed.args.includes('+faststart'));
    }
    assert.ok(embed.args.includes('title=Track title') && embed.args.includes('artist=Source artist') && embed.args.includes('album=Source album'));
    await assertClean(context);
  }
});

test('unsupported WebM stays byte-for-byte unchanged with an optional validated sidecar', async t => {
  const context = await fixture(t, { format: 'webm' });
  const skipped = await context.run();
  assert.equal(skipped.embedded, false);
  assert.match(skipped.warnings[0], /does not support/);
  assert.equal(context.calls.length, 0);
  const result = await context.run({ thumbnailSidecar: true });
  assert.equal(result.embedded, false);
  assert.ok(result.sidecarPath.endsWith('.jpg'));
  assert.deepEqual(await fs.readFile(result.sidecarPath), jpeg);
  assert.equal(await fs.readFile(context.filePath, 'utf8'), 'original media bytes');
  assert.ok(!context.calls.some(call => call.args.includes('-attach') || call.args.includes('attached_pic')));
  await fs.rm(result.sidecarPath);
  await assertClean(context);
});

test('unsupported source image converts once to PNG without resizing', async t => {
  const context = await fixture(t, { imageBytes: Buffer.from('RIFF WEBP'), imageCodec: 'webp' });
  assert.equal((await context.run()).embedded, true);
  const conversions = context.calls.filter(call => call.args.includes('image2'));
  assert.equal(conversions.length, 1);
  assert.ok(conversions[0].args.includes('png'));
  assert.ok(!conversions[0].args.some(arg => arg === '-vf' || arg === '-s'));
  await assertClean(context);
});

test('source PNG stays unchanged and missing thumbnail downloads remain nonfatal', async t => {
  const pngContext = await fixture(t, { imageBytes: png, imageCodec: 'png', format: 'webm' });
  const pngResult = await pngContext.run({ thumbnailSidecar: true });
  assert.deepEqual(await fs.readFile(pngResult.sidecarPath), png);
  assert.ok(!pngContext.calls.some(call => call.args.includes('image2')));
  await fs.rm(pngResult.sidecarPath);
  await assertClean(pngContext);
  const missing = await fixture(t, { fail: async operation => operation === 'download' ? { code: 0, stdout: '', stderr: '' } : null });
  const missingResult = await missing.run();
  assert.equal(missingResult.embedded, false);
  assert.match(missingResult.warnings[0], /could not be downloaded/);
  assert.equal(await fs.readFile(missing.filePath, 'utf8'), 'original media bytes');
  await assertClean(missing);
});

test('missing executable and corrupt image keep the successful media and clean temporary images', async t => {
  for (const failure of ['ffprobe_missing', 'ffmpeg_missing', 'corrupt']) {
    const context = await fixture(t, { fail: async operation => {
      if (failure === 'ffprobe_missing' && operation === 'probe_image') throw new Error('Required tool is missing: ffprobe');
      if (failure === 'ffmpeg_missing' && operation === 'validate_image') throw new Error('Required tool is missing: ffmpeg');
      if (failure === 'corrupt' && operation === 'validate_image') return { code: 1, stderr: 'corrupt input', stdout: '' };
    } });
    const result = await context.run();
    assert.equal(result.embedded, false);
    assert.equal(result.warnings.length, 1);
    assert.equal(await fs.readFile(context.filePath, 'utf8'), 'original media bytes');
    await assertClean(context);
  }
});

test('embedding failure retains original media and can save the already-downloaded artwork', async t => {
  const context = await fixture(t, { fail: async (operation, { args }) => {
    if (operation === 'embed') {
      await fs.writeFile(args.at(-1), 'partial output');
      return { code: 1, stderr: 'muxer failed', stdout: '' };
    }
  } });
  const result = await context.run({ thumbnailSidecar: true });
  assert.equal(result.embedded, false);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(await fs.readFile(result.sidecarPath), jpeg);
  assert.equal(context.calls.filter(call => call.command === 'yt-dlp').length, 1);
  assert.equal(await fs.readFile(context.filePath, 'utf8'), 'original media bytes');
  await fs.rm(result.sidecarPath);
  await assertClean(context);
});

test('invalid remux results never replace the downloaded media', async t => {
  const context = await fixture(t, { fail: async operation => operation === 'probe_result'
    ? { code: 0, stdout: JSON.stringify({ streams: [{ ...audioStream, codec_name: 'aac' }, coverStream], format: { duration: '3' } }), stderr: '' } : null });
  const result = await context.run();
  assert.equal(result.embedded, false);
  assert.equal(await fs.readFile(context.filePath, 'utf8'), 'original media bytes');
  await assertClean(context);
});

test('cancellation during embedding propagates and cleans candidate and image files', async t => {
  const controller = new AbortController();
  const context = await fixture(t, { fail: async (operation, { args, options }) => {
    if (operation === 'embed') {
      assert.equal(options.signal, controller.signal);
      await fs.writeFile(args.at(-1), 'partial output');
      controller.abort();
      throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    }
  } });
  await assert.rejects(context.run({ signal: controller.signal, thumbnailSidecar: true }), error => error.name === 'AbortError');
  assert.equal(await fs.readFile(context.filePath, 'utf8'), 'original media bytes');
  await assertClean(context);
});
