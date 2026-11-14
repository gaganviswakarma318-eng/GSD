const { runProcess } = require('../utils/processes');
const { ApiError, mediaError, validatePublicUrl } = require('../utils/errors');
const { buildOptions, publicOption } = require('./formats');

function commonArgs(config, { cookies = true } = {}) {
  const args = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--no-colors', '--socket-timeout', '30', '--retries', '2', '--no-js-runtimes', '--js-runtimes', `node:${config.tools.node}`];
  if (cookies && config.cookiesFromBrowser) args.push('--cookies-from-browser', config.cookiesFromBrowser);
  return args;
}

async function enrichDirectMedia(raw, config, availability, signal) {
  const formats = Array.isArray(raw.formats) ? raw.formats : [raw];
  if (!availability.ffprobe || formats.length > 2 || formats.some(f => f.vcodec && f.vcodec !== 'none' || f.acodec && f.acodec !== 'none')) return;
  for (const format of formats) {
    if (!format.url || !/^(mp4|webm|mkv|mov|mp3|m4a|ogg|opus|flac|wav|aac)$/i.test(format.ext || '')) continue;
    try {
      await validatePublicUrl(format.url, config.allowPrivateUrls);
      const result = await runProcess(config.tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', format.url], { signal, timeoutMs: 30000, maxOutput: 1024 * 1024 });
      if (result.code !== 0) continue;
      const probe = JSON.parse(result.stdout);
      const video = probe.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
      const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
      format.vcodec = video?.codec_name || 'none';
      format.acodec = audio?.codec_name || 'none';
      if (video) {
        format.width = video.width; format.height = video.height;
        const [numerator, denominator] = String(video.avg_frame_rate || '0/1').split('/').map(Number);
        format.fps = denominator ? numerator / denominator : 0;
      }
      if (audio?.bit_rate) format.abr = Number(audio.bit_rate) / 1000;
      if (probe.format?.size) format.filesize = Number(probe.format.size);
      if (!raw.duration && probe.format?.duration) raw.duration = Number(probe.format.duration);
    } catch (error) { if (signal.aborted) throw error; }
  }
}

class MetadataService {
  constructor(config, availability, { processRunner = runProcess } = {}) {
    this.config = config;
    this.availability = availability;
    this.processRunner = processRunner;
    this.cache = new Map();
    this.pending = new Map();
    this.waiting = [];
    this.active = 0;
    this.closed = false;
    this.controllers = new Set();
  }

  async get(value, { refresh = false } = {}) {
    if (this.closed) throw new ApiError('GSD is shutting down.', 503);
    const url = await validatePublicUrl(value, this.config.allowPrivateUrls);
    const cached = this.cache.get(url);
    if (!refresh && cached && cached.expires > Date.now()) return cached.value;
    if (this.pending.has(url)) return this.pending.get(url);
    if (!this.availability.ytDlp) throw new ApiError('yt-dlp is missing or cannot run. Run npm run prepare:tools:linux, or configure GSD_YTDLP_PATH.', 503, 'MISSING_TOOL');
    if (this.waiting.length >= 20) throw new ApiError('Too many links are being analyzed. Try again shortly.', 429, 'QUEUE_FULL');
    const promise = this.schedule(async () => {
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        const result = await this.processRunner(this.config.tools.ytDlp, [...commonArgs(this.config), '--dump-single-json', '--skip-download', '--', url], { signal: controller.signal, timeoutMs: this.config.metadataTimeoutMs });
        if (result.code !== 0) throw new ApiError(mediaError(result.stderr), 422, 'SOURCE_ERROR');
        let raw;
        try { raw = JSON.parse(result.stdout); } catch { throw new ApiError('The source returned invalid media information. Try another supported link.', 422, 'SOURCE_ERROR'); }
        if (raw.entries || raw._type === 'playlist') throw new ApiError('Paste a single media link rather than a playlist.', 422, 'PLAYLIST_UNSUPPORTED');
        if (raw.is_live || raw.live_status === 'is_live' || raw.live_status === 'is_upcoming') throw new ApiError('Live and upcoming streams are not supported. Try again after the recording is available.', 422, 'LIVE_UNSUPPORTED');
        if (raw.has_drm) throw new ApiError('This media is protected by DRM and cannot be downloaded.', 422, 'DRM_UNSUPPORTED');
        await enrichDirectMedia(raw, this.config, this.availability, controller.signal);
        const options = buildOptions(raw, this.availability);
        if (!options.length) throw new ApiError(this.availability.ffmpeg ? 'This source does not offer a downloadable audio or video format.' : 'This source needs FFmpeg for extraction or merging. Reinstall GSD or configure GSD_FFMPEG_PATH.', 422, 'NO_FORMATS');
        const thumbnail = typeof raw.thumbnail === 'string' && /^https?:\/\//i.test(raw.thumbnail) ? raw.thumbnail : '';
        const viewCount = raw.view_count == null ? NaN : Number(raw.view_count);
        const creator = raw.channel || raw.uploader || raw.creator || '';
        const value = { raw, options, public: { url, title: String(raw.title || 'Untitled media').slice(0, 500), thumbnail, duration: Number(raw.duration) || null, extractor: String(raw.extractor_key || raw.extractor || 'Media'), creator: String(creator).slice(0, 300) || null, viewCount: Number.isFinite(viewCount) && viewCount >= 0 ? viewCount : null, options: options.map(publicOption) } };
        this.cache.delete(url);
        this.cache.set(url, { value, expires: Date.now() + this.config.metadataTtlMs });
        while (this.cache.size > this.config.maxMetadataEntries) this.cache.delete(this.cache.keys().next().value);
        return value;
      } finally { this.controllers.delete(controller); }
    });
    this.pending.set(url, promise);
    try { return await promise; } finally { this.pending.delete(url); }
  }

  schedule(task) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ task, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (!this.closed && this.active < this.config.metadataConcurrency && this.waiting.length) {
      const item = this.waiting.shift();
      this.active++;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => { this.active--; this.pump(); });
    }
  }

  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const item of this.waiting.splice(0)) item.reject(new Error('GSD is shutting down.'));
    return Promise.allSettled([...this.pending.values()]);
  }
}

module.exports = { MetadataService, commonArgs, enrichDirectMedia };
