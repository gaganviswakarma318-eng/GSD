const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runProcess } = require('../../utils/processes');

const METHODS = {
  mp3: 'id3v2', m4a: 'mp4', m4b: 'mp4', mp4: 'mp4', m4v: 'mp4',
  flac: 'flac', mkv: 'matroska', mka: 'matroska',
};

function thumbnailSupport(format) {
  const method = METHODS[String(format || '').toLowerCase()] || null;
  return {
    supported: Boolean(method), method,
    reason: method === 'matroska'
      ? 'Stores artwork as a cover attachment; visibility depends on the player.'
      : method ? 'Supports embedded cover artwork; visibility depends on the player.'
        : 'This format does not support embedded artwork in GSD. You can save a separate thumbnail.',
  };
}

function checkAbort(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
}

async function execute(config, command, args, context) {
  checkAbort(context.signal);
  if (!command) throw new Error('ARTWORK_TOOL_MISSING');
  const result = await context.processRunner(command, args, {
    signal: context.signal, cwd: context.tempDir, timeoutMs: context.timeoutMs ?? 120000, maxOutput: 2 * 1024 * 1024,
  });
  checkAbort(context.signal);
  if (result.code !== 0) throw new Error('ARTWORK_PROCESS_FAILED');
  return result;
}

async function probe(config, filename, context) {
  const result = await execute(config, config.tools.ffprobe, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename,
  ], context);
  const value = JSON.parse(result.stdout);
  if (!Array.isArray(value.streams) || !value.streams.length) throw new Error('ARTWORK_INVALID_MEDIA');
  return value;
}

function artworkStream(stream) {
  return Boolean(stream.disposition?.attached_pic) ||
    /^cover(?:_land)?\.(?:jpe?g|png)$/i.test(stream.tags?.filename || '') &&
    /^image\//i.test(stream.tags?.mimetype || '');
}

function mediaStreams(info) {
  return info.streams.filter(stream => !artworkStream(stream));
}

function metadataArgs(raw, original) {
  const tags = new Set(Object.keys(original.format?.tags || {}).map(key => key.toLowerCase()));
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 2000) : '';
  const artist = raw.artist || (Array.isArray(raw.artists) ? raw.artists.join(', ') : '') || raw.creator;
  const values = {
    title: raw.track || raw.title, artist, album: raw.album,
    album_artist: raw.album_artist || (Array.isArray(raw.album_artists) ? raw.album_artists.join(', ') : ''),
    track: raw.track_number, disc: raw.disc_number, date: raw.release_date || raw.upload_date,
    genre: raw.genre || (Array.isArray(raw.genres) ? raw.genres.join(', ') : ''),
  };
  return Object.entries(values).flatMap(([key, value]) => !tags.has(key) && text(value) ? ['-metadata', `${key}=${text(value)}`] : []);
}

async function prepareImage(config, downloaded, scratch, context) {
  const stat = await fs.stat(downloaded);
  if (!stat.isFile() || !stat.size || stat.size > 25 * 1024 * 1024) throw new Error('ARTWORK_INVALID_IMAGE');
  const input = await probe(config, downloaded, context);
  const image = input.streams.find(stream => stream.codec_type === 'video');
  if (!image || !image.width || !image.height || image.width * image.height > 100000000 ||
      !/^(mjpeg|png|webp|gif|bmp|tiff|av1|jpeg2000|jpegls)$/.test(image.codec_name || '') ||
      !/(?:image2|_pipe|gif|avif|heic)/.test(input.format?.format_name || '')) throw new Error('ARTWORK_INVALID_IMAGE');
  const handle = await fs.open(downloaded, 'r');
  const header = Buffer.alloc(8);
  try { await handle.read(header, 0, 8, 0); } finally { await handle.close(); }
  const jpeg = image.codec_name === 'mjpeg' && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const png = image.codec_name === 'png' && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const extension = jpeg ? 'jpg' : 'png';
  const prepared = path.join(scratch, `artwork.${extension}`);
  if (jpeg || png) {
    // Decode to a null sink to reject truncated/corrupt images without changing
    // the original JPEG/PNG bytes or introducing another lossy generation.
    await execute(config, config.tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-i', downloaded, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], context);
    await fs.copyFile(downloaded, prepared, constants.COPYFILE_EXCL);
  } else {
    await execute(config, config.tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-n', '-i', downloaded, '-map', '0:v:0', '-frames:v', '1', '-c:v', 'png', '-f', 'image2', '-update', '1', prepared], context);
    const converted = await probe(config, prepared, context);
    const outputImage = converted.streams.find(stream => stream.codec_type === 'video');
    if (outputImage?.codec_name !== 'png' || outputImage.width !== image.width || outputImage.height !== image.height) throw new Error('ARTWORK_INVALID_IMAGE');
  }
  return { filePath: prepared, extension, width: image.width, height: image.height };
}

function embeddingArgs(filePath, output, image, method, raw, original) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', filePath];
  if (method !== 'matroska') args.push('-i', image.filePath);
  args.push('-map', '0');
  for (const stream of original.streams.filter(artworkStream)) args.push('-map', `-0:${stream.index}`);
  const coverIndex = mediaStreams(original).length;
  if (method !== 'matroska') args.push('-map', '1:v:0');
  args.push('-c', 'copy', '-map_metadata', '0', '-map_chapters', '0', ...metadataArgs(raw, original));
  if (method === 'matroska') {
    args.push('-attach', image.filePath, `-metadata:s:${coverIndex}`, `mimetype=image/${image.extension === 'jpg' ? 'jpeg' : 'png'}`, `-metadata:s:${coverIndex}`, `filename=cover.${image.extension}`);
  } else {
    args.push(`-disposition:${coverIndex}`, 'attached_pic', `-metadata:s:${coverIndex}`, 'title=Album cover', `-metadata:s:${coverIndex}`, 'comment=Cover (front)');
    if (method === 'id3v2') args.push('-id3v2_version', '3');
    if (method === 'mp4') args.push('-movflags', '+faststart');
  }
  return [...args, output];
}

function validateResult(original, result, method) {
  const before = mediaStreams(original);
  const after = mediaStreams(result);
  if (before.length !== after.length || before.some((stream, index) =>
    stream.codec_type !== after[index].codec_type || stream.codec_name !== after[index].codec_name ||
    stream.codec_type === 'video' && (stream.width !== after[index].width || stream.height !== after[index].height) ||
    stream.codec_type === 'audio' && (String(stream.sample_rate) !== String(after[index].sample_rate) || stream.channels !== after[index].channels))) throw new Error('ARTWORK_INVALID_RESULT');
  if (!result.streams.some(stream => method === 'matroska'
    ? /^cover\.(jpg|png)$/.test(stream.tags?.filename || '') && /^image\//.test(stream.tags?.mimetype || '')
    : Boolean(stream.disposition?.attached_pic))) throw new Error('ARTWORK_INVALID_RESULT');
  const duration = Number(original.format?.duration);
  const outputDuration = Number(result.format?.duration);
  if (duration > 0 && (!Number.isFinite(outputDuration) || Math.abs(duration - outputDuration) > Math.max(0.25, duration * 0.001))) throw new Error('ARTWORK_INVALID_RESULT');
}

async function processThumbnail({ config, raw, option, filePath, tempDir, infoPath, signal, onProgress = () => {}, embedThumbnail = true, thumbnailSidecar = false, processRunner = runProcess }) {
  const warnings = [];
  const support = thumbnailSupport(path.extname(filePath).slice(1) || option?.format);
  const context = { tempDir, signal, processRunner };
  let scratch, candidate, image, sidecarPath;
  let stage = 'thumbnail download';
  let embedded = false;
  if (!embedThumbnail && !thumbnailSidecar) return { embedded, warnings };
  checkAbort(signal);
  if (!support.supported && !thumbnailSidecar) {
    if (embedThumbnail) warnings.push('This container does not support artwork embedding in GSD. The downloaded media was kept.');
    console.info('[thumbnail] Skipping artwork: unsupported container and no sidecar requested.');
    return { embedded, warnings };
  }
  if (!raw.thumbnail && !(Array.isArray(raw.thumbnails) && raw.thumbnails.some(value => value?.url))) {
    warnings.push('No thumbnail is available. The downloaded media was kept.');
    console.info('[thumbnail] Skipping artwork: the source has no thumbnail.');
    return { embedded, warnings };
  }
  try {
    onProgress({ status: 'processing', stage: 'processing_thumbnail', speedBytes: null, etaSeconds: null });
    console.info('[thumbnail] Processing source artwork.');
    scratch = await fs.mkdtemp(path.join(tempDir, 'thumbnail-'));
    // Reuse the same extracted info JSON as the media download. yt-dlp selects
    // its highest ranked available image and falls back when a CDN image fails.
    const { commonArgs } = require('../yt-dlp/metadata');
    await execute(config, config.tools.ytDlp, [
      ...commonArgs(config), '--skip-download', '--write-thumbnail', '--no-write-playlist-metafiles',
      '--paths', scratch, '--output', 'cover.%(ext)s', '--output', 'thumbnail:cover.%(ext)s',
      '--load-info-json', infoPath,
    ], context);
    const entries = await fs.readdir(scratch, { withFileTypes: true });
    const downloaded = entries.find(entry => entry.isFile() && /^cover\.[a-z0-9]+$/i.test(entry.name));
    if (!downloaded) throw new Error('ARTWORK_NOT_DOWNLOADED');
    stage = 'image validation';
    image = await prepareImage(config, path.join(scratch, downloaded.name), scratch, context);
    if (embedThumbnail && support.supported) {
      onProgress({ status: 'processing', stage: 'embedding_thumbnail', speedBytes: null, etaSeconds: null });
      console.info(`[thumbnail] Embedding artwork using ${support.method}.`);
      stage = 'media inspection';
      const original = await probe(config, filePath, context);
      candidate = path.join(tempDir, `.artwork-${crypto.randomUUID()}${path.extname(filePath)}`);
      stage = 'artwork embedding';
      await execute(config, config.tools.ffmpeg, embeddingArgs(filePath, candidate, image, support.method, raw, original), { ...context, timeoutMs: 0 });
      stage = 'output validation';
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || !stat.size) throw new Error('ARTWORK_INVALID_RESULT');
      validateResult(original, await probe(config, candidate, context), support.method);
      checkAbort(signal);
      // Never delete the successfully downloaded original first. A validated
      // replacement in the same directory is committed with one atomic rename.
      await fs.rename(candidate, filePath);
      candidate = null;
      embedded = true;
      console.info('[thumbnail] Embedded artwork successfully.');
    } else if (embedThumbnail && !support.supported) {
      warnings.push('This container does not support artwork embedding in GSD. A separate thumbnail was saved.');
    }
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    warnings.push(/missing|ENOENT|ARTWORK_TOOL_MISSING/i.test(error.message)
      ? 'Artwork processing needs FFmpeg and FFprobe. The downloaded media was kept.'
      : error.message === 'ARTWORK_NOT_DOWNLOADED'
        ? 'The source thumbnail could not be downloaded. The downloaded media was kept.'
        : 'Thumbnail processing failed. The downloaded media was kept without changing its quality.');
    const category = /^ARTWORK_[A-Z_]+$/.test(error.message) ? error.message
      : /missing|ENOENT/i.test(error.message) ? 'ARTWORK_TOOL_MISSING' : 'ARTWORK_PROCESS_ERROR';
    console.warn(`[thumbnail] Artwork processing failed during ${stage} (${category}); keeping downloaded media.`);
  } finally {
    try {
      if (!embedded && thumbnailSidecar && image) {
        checkAbort(signal);
        sidecarPath = path.join(tempDir, `thumbnail-${crypto.randomUUID()}.${image.extension}`);
        await fs.copyFile(image.filePath, sidecarPath, constants.COPYFILE_EXCL);
      }
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') {
        if (sidecarPath) await fs.rm(sidecarPath, { force: true });
        sidecarPath = null;
        // The outer abort is rethrown after temporary files are removed below.
      } else {
        if (sidecarPath) await fs.rm(sidecarPath, { force: true }).catch(() => {});
        sidecarPath = null;
        warnings.push('The separate thumbnail could not be saved. The downloaded media was kept.');
      }
    }
    let cleanupFailed = false;
    if (candidate) await fs.rm(candidate, { force: true }).catch(() => { cleanupFailed = true; });
    if (scratch) await fs.rm(scratch, { recursive: true, force: true }).catch(() => { cleanupFailed = true; });
    if (cleanupFailed) {
      warnings.push('Some temporary artwork files could not be removed.');
      console.warn('[thumbnail] Temporary artwork cleanup was incomplete.');
    }
  }
  checkAbort(signal);
  return { embedded, warnings, ...(sidecarPath ? { sidecarPath } : {}) };
}

module.exports = { thumbnailSupport, processThumbnail };
