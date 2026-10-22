const fs = require('node:fs/promises');
const path = require('node:path');
const { runProcess } = require('../utils/processes');
const { mediaError } = require('../utils/errors');
const { commonArgs } = require('./metadata');

function numeric(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }

function parseProgress(line) {
  if (!line.startsWith('GSD_PROGRESS:')) return null;
  try {
    const value = JSON.parse(line.slice('GSD_PROGRESS:'.length));
    const total = numeric(value.total_bytes) || numeric(value.total_bytes_estimate);
    const downloaded = numeric(value.downloaded_bytes) || 0;
    return { downloadedBytes: downloaded, totalBytes: total, progress: total ? Math.min(99, downloaded / total * 100) : 0, speedBytes: numeric(value.speed), etaSeconds: numeric(value.eta), streamId: String(value.format_id || 'source'), streamFinished: value.status === 'finished' };
  } catch { return null; }
}

function buildArgs(config, option, infoPath, tempDir) {
  const args = [...commonArgs(config), '--no-simulate', '--newline', '--progress', '--progress-delta', '0.3', '--concurrent-fragments', '3', '--fragment-retries', '3', '--windows-filenames', '--no-overwrites', '--paths', tempDir, '--output', 'media.%(ext)s', '--format', option.selector,
    '--progress-template', 'download:GSD_PROGRESS:{"downloaded_bytes":%(progress.downloaded_bytes|0)s,"total_bytes":%(progress.total_bytes|0)s,"total_bytes_estimate":%(progress.total_bytes_estimate|0)s,"speed":%(progress.speed|0)s,"eta":%(progress.eta|0)s,"format_id":%(info.format_id)j,"status":%(progress.status)j}', '--progress-template', 'postprocess:GSD_PROCESSING:%(progress.status)s', '--print', 'after_move:GSD_FILE:%(filepath)j', '--load-info-json', infoPath];
  if (config.tools.ffmpeg) args.push('--ffmpeg-location', config.tools.ffmpeg);
  if (option.merged) args.push('--merge-output-format', option.format);
  if (option.extractAudio) args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '2');
  return args;
}

async function runDownload({ config, raw, option, tempDir, signal, onProgress }) {
  const infoPath = path.join(tempDir, 'source.info.json');
  await fs.writeFile(infoPath, JSON.stringify(raw), { mode: 0o600 });
  let filePath = null;
  const streams = new Map();
  const result = await runProcess(config.tools.ytDlp, buildArgs(config, option, infoPath, tempDir), {
    signal,
    cwd: tempDir,
    captureStdout: false,
    onLine(line) {
      const progress = parseProgress(line);
      if (progress) {
        const { streamId, streamFinished, ...current } = progress;
        streams.set(streamId, current);
        const downloadedBytes = [...streams.values()].reduce((sum, stream) => sum + stream.downloadedBytes, 0);
        const knownTotal = option.estimatedSize || (option.merged ? null : current.totalBytes);
        const etaSeconds = option.merged && knownTotal && current.speedBytes ? Math.max(0, (knownTotal - downloadedBytes) / current.speedBytes) : current.etaSeconds;
        onProgress({ ...current, downloadedBytes, totalBytes: knownTotal, etaSeconds, progress: knownTotal ? Math.min(99, downloadedBytes / knownTotal * 100) : 0, status: 'downloading' });
      }
      else if (line.startsWith('GSD_PROCESSING:') || /^\[(Merger|ExtractAudio|VideoRemuxer|Fixup)/.test(line)) onProgress({ status: 'processing', speedBytes: null, etaSeconds: null });
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
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || !stat.size) throw new Error('The source produced an empty media file.');
  return { filePath: resolved, size: stat.size };
}

module.exports = { runDownload, buildArgs, parseProgress };
