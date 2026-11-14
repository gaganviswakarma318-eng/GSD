const fs = require('node:fs/promises');
const path = require('node:path');
const { runProcess } = require('../utils/processes');
const { mediaError } = require('../utils/errors');
const { commonArgs } = require('./metadata');
const { processThumbnail } = require('./thumbnail');

function numeric(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }

function parseProgress(line) {
  if (!line.startsWith('GSD_PROGRESS:')) return null;
  try {
    const value = JSON.parse(line.slice('GSD_PROGRESS:'.length));
    const total = numeric(value.total_bytes) || numeric(value.total_bytes_estimate) || null;
    const downloaded = numeric(value.downloaded_bytes) || 0;
    return { downloadedBytes: downloaded, totalBytes: total, progress: total ? Math.min(99, downloaded / total * 100) : 0, speedBytes: numeric(value.speed), etaSeconds: numeric(value.eta), streamId: String(value.format_id || 'source'), streamFinished: value.status === 'finished' };
  } catch { return null; }
}

function sectionTime(seconds) {
  return Number(seconds.toFixed(3)).toString();
}

function buildArgs(config, option, infoPath, tempDir, clipRange, source) {
  const args = [...commonArgs(config, { cookies: source !== 'instagram' }), '--no-simulate', '--newline', '--progress', '--progress-delta', '0.3', '--concurrent-fragments', '3', '--fragment-retries', '3', '--windows-filenames', '--no-overwrites', '--paths', tempDir, '--output', 'media.%(ext)s', '--format', option.selector,
    '--progress-template', 'download:GSD_PROGRESS:{"downloaded_bytes":%(progress.downloaded_bytes|0)s,"total_bytes":%(progress.total_bytes|0)s,"total_bytes_estimate":%(progress.total_bytes_estimate|0)s,"speed":%(progress.speed|0)s,"eta":%(progress.eta|0)s,"format_id":%(info.format_id)j,"status":%(progress.status)j}', '--progress-template', 'postprocess:GSD_PROCESSING:{"postprocessor":%(progress.postprocessor)j,"status":%(progress.status)j}', '--print', 'after_move:GSD_FILE:%(filepath)j', '--load-info-json', infoPath];
  if (clipRange) args.push('--download-sections', `*${sectionTime(clipRange.startSeconds)}-${sectionTime(clipRange.endSeconds)}`, '--force-keyframes-at-cuts');
  const ffmpeg = config.tools.ffmpeg;
  if (ffmpeg && (/[\\/]/.test(ffmpeg) || /^[A-Za-z]:/.test(ffmpeg))) args.push('--ffmpeg-location', ffmpeg);
  if (option.merged) args.push('--merge-output-format', option.format);
  if (option.extractAudio) args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '2');
  return args;
}

async function runDownload({ config, raw, option, clipRange, tempDir, signal, onProgress, embedThumbnail = true, thumbnailSidecar = false, source, processRunner = runProcess }) {
  const infoPath = path.join(tempDir, 'source.info.json');
  await fs.writeFile(infoPath, JSON.stringify(raw), { mode: 0o600 });
  let filePath = null;
  const args = buildArgs(config, option, infoPath, tempDir, clipRange, source);
  const duration = numeric(raw.duration);
  const sizeRatio = clipRange && duration
    ? Math.min(1, (clipRange.endSeconds - clipRange.startSeconds) / duration)
    : 1;
  // Account for every selected source before the first progress event. A video
  // stream finishing does not mean its companion audio has been downloaded.
  const formats = Array.isArray(raw.formats) ? raw.formats : [raw];
  const streams = new Map(option.selector.split('+').map(id => {
    const format = formats.find(value => String(value.format_id) === id);
    const sourceBytes = numeric(format?.filesize) || numeric(format?.filesize_approx) || (option.merged ? null : numeric(option.estimatedSize)) || null;
    const totalBytes = sourceBytes ? Math.max(1, Math.round(sourceBytes * sizeRatio)) : null;
    return [id, { downloadedBytes: 0, totalBytes }];
  }));
  const result = await processRunner(config.tools.ytDlp, args, {
    signal,
    cwd: tempDir,
    captureStdout: false,
    onLine(line) {
      const progress = parseProgress(line);
      if (progress) {
        const { streamId, streamFinished, ...current } = progress;
        const previous = streams.get(streamId);
        streams.set(streamId, {
          downloadedBytes: current.downloadedBytes,
          totalBytes: (streamFinished ? current.downloadedBytes : current.totalBytes) || previous?.totalBytes || null,
        });
        const sources = [...streams.values()];
        const downloadedBytes = sources.reduce((sum, stream) => sum + stream.downloadedBytes, 0);
        const knownTotal = sources.every(stream => stream.totalBytes > 0) ? sources.reduce((sum, stream) => sum + stream.totalBytes, 0) : null;
        const speedBytes = streamFinished ? null : current.speedBytes;
        const etaSeconds = !knownTotal || streamFinished ? null : option.merged ? speedBytes ? Math.max(0, (knownTotal - downloadedBytes) / speedBytes) : null : current.etaSeconds;
        onProgress({ downloadedBytes, totalBytes: knownTotal, speedBytes, etaSeconds, progress: knownTotal ? Math.min(99, downloadedBytes / knownTotal * 100) : 0, status: 'downloading', stage: 'downloading' });
      }
      else if (line.startsWith('GSD_PROCESSING:') || /^\[(Merger|ExtractAudio|VideoRemuxer|Fixup)/.test(line)) {
        let postprocessor = /^\[([^\]]+)\]/.exec(line)?.[1];
        if (line.startsWith('GSD_PROCESSING:')) {
          try { postprocessor = JSON.parse(line.slice('GSD_PROCESSING:'.length)).postprocessor; } catch {}
        }
        const stage = postprocessor === 'Merger' ? 'merging' : postprocessor === 'ExtractAudio' ? 'converting_audio' : clipRange && /^FFmpegVideo/.test(postprocessor || '') ? 'trimming' : null;
        onProgress({ status: 'processing', ...(stage ? { stage } : {}), speedBytes: null, etaSeconds: null });
      }
      else if (line.startsWith('GSD_FILE:')) { try { filePath = JSON.parse(line.slice(9)); } catch {} }
    },
  });
  if (result.code !== 0) throw new Error(mediaError(result.stderr));
  if (!filePath) throw new Error('The media tool finished without producing a file. Analyze the source again and retry.');
  const resolved = path.resolve(filePath);
  const normalizedParent = path.toNamespacedPath(path.resolve(path.dirname(resolved)));
  const expectedParent = path.toNamespacedPath(path.resolve(tempDir));
  if ((process.platform === 'win32' ? normalizedParent.toLowerCase() !== expectedParent.toLowerCase() : normalizedParent !== expectedParent)) {
    throw new Error('The media tool returned an invalid output path.');
  }
  let stat = await fs.stat(resolved);
  if (!stat.isFile() || !stat.size) throw new Error('The source produced an empty media file.');
  const artwork = await processThumbnail({ config, raw, option, filePath: resolved, tempDir, infoPath, signal, onProgress, embedThumbnail, thumbnailSidecar, processRunner });
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
  onProgress({ status: 'processing', stage: 'finalizing', speedBytes: null, etaSeconds: null });
  await fs.rm(infoPath, { force: true }).catch(() => {
    artwork.warnings.push('The media is ready, but a temporary metadata file could not be removed. GSD will retry cleanup after delivery.');
    console.warn('[download] Temporary metadata cleanup deferred until delivery.');
  });
  stat = await fs.stat(resolved);
  return { filePath: resolved, size: stat.size, thumbnailEmbedded: artwork.embedded, warnings: artwork.warnings, sidecarPath: artwork.sidecarPath };
}

module.exports = { runDownload, buildArgs, parseProgress };
