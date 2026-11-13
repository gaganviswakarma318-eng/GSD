const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { ApiError } = require('../utils/errors');
const { runDownload } = require('./downloader');

const ACTIVE = new Set(['queued', 'downloading', 'processing']);
function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
function safeFilename(title, format, id) {
  let name = String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 130);
  if (!name) name = 'GSD media';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name} [${id.slice(0, 8)}].${format}`;
}

function validateClipRange(clipRange, duration) {
  if (
    !clipRange ||
    typeof clipRange !== 'object' ||
    !Number.isFinite(clipRange.startSeconds) ||
    !Number.isFinite(clipRange.endSeconds) ||
    clipRange.startSeconds < 0 ||
    clipRange.endSeconds <= clipRange.startSeconds
  )
    throw new ApiError('Enter a valid clip start and end time.', 400, 'INVALID_CLIP_RANGE');
  if (!Number.isFinite(duration) || duration <= 0)
    throw new ApiError('This source does not report a video duration, so GSD cannot validate a clip range.', 422, 'INVALID_CLIP_RANGE');
  if (clipRange.endSeconds > duration)
    throw new ApiError('The clip end time must be within the video duration.', 422, 'INVALID_CLIP_RANGE');
  return { startSeconds: clipRange.startSeconds, endSeconds: clipRange.endSeconds };
}

class DownloadManager {
  constructor(config, metadata, { runner = runDownload, now = Date.now } = {}) {
    this.config = config;
    this.metadata = metadata;
    this.runner = runner;
    this.now = now;
    this.jobs = new Map();
    this.queue = [];
    this.active = new Set();
    this.events = new EventEmitter();
    this.events.setMaxListeners(200);
    this.closed = false;
    this.sweeper = setInterval(() => { void this.sweep().catch(error => console.error('GSD cleanup:', error.message)); }, config.cleanupIntervalMs);
    this.sweeper.unref();
  }

  async initialize() {
    await fs.mkdir(this.config.tempRoot, { recursive: true });
    // Only reap this application's abandoned run folders, never unrelated files.
    for (const entry of await fs.readdir(this.config.tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^run-[a-zA-Z0-9]+$/.test(entry.name)) continue;
      const candidate = path.join(this.config.tempRoot, entry.name);
      const stat = await fs.stat(candidate).catch(() => null);
      let stale = stat && Date.now() - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000;
      try {
        const owner = JSON.parse(await fs.readFile(path.join(candidate, 'owner.json'), 'utf8'));
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); stale = false; }
          catch (error) { stale = error.code === 'ESRCH'; }
        }
      } catch {}
      if (stale) await fs.rm(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    }
    this.runRoot = await fs.mkdtemp(path.join(this.config.tempRoot, 'run-'));
    await fs.writeFile(path.join(this.runRoot, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  }

  view(record) {
    if (!record) return null;
    const { owner, raw, option, destination, filePath, sidecarPath, tempDir, controller, promise, transfers, settling, deliveryAcknowledged, mediaDelivered, expiring, ...view } = record;
    return { ...view };
  }

  get(id) { return this.view(this.jobs.get(id)); }
  getRecord(id) { return this.jobs.get(id); }
  list(owner) { return [...this.jobs.values()].filter(job => job.owner === owner && !job.expiring).map(job => this.view(job)).sort((a, b) => b.createdAt - a.createdAt); }
  owned(id, owner) {
    const record = this.jobs.get(id);
    if (!record || record.owner !== owner || record.expiring) throw new ApiError('This download was not found or has expired.', 404, 'NOT_FOUND');
    return record;
  }
  hasActive(owner) { return [...this.jobs.values()].some(job => job.owner === owner && (ACTIVE.has(job.status) || this.active.has(job.id))); }

  update(record, patch) {
    Object.assign(record, patch, { updatedAt: this.now() });
    this.events.emit(record.id, this.view(record));
    this.events.emit('change', record.owner, this.view(record));
  }

  checkCapacity() {
    if (this.closed) throw new ApiError('GSD is shutting down.', 503);
    if (this.queue.length >= this.config.maxPending || this.jobs.size >= 500) throw new ApiError('The download queue is full. Wait for a download to finish before adding another.', 429, 'QUEUE_FULL');
  }

  async create({ url, optionId, saveToken, embedThumbnail = true, thumbnailSidecar = false, clipRange }, owner) {
    if (typeof embedThumbnail !== 'boolean' || typeof thumbnailSidecar !== 'boolean') throw new ApiError('Thumbnail settings must be true or false.', 400, 'INVALID_OPTIONS');
    this.checkCapacity();
    const info = await this.metadata.get(url);
    const option = info.options.find(value => value.id === optionId);
    if (!option) throw new ApiError('This format is no longer available. Analyze the link again and choose a current quality.', 422, 'INVALID_OPTION');
    let selectedClip = null;
    if (clipRange !== undefined) {
      if (option.type !== 'video') throw new ApiError('Clip downloads require a video format.', 400, 'INVALID_CLIP_RANGE');
      if (this.metadata.availability?.ffmpeg === false) throw new ApiError('Clip downloads require FFmpeg. Install FFmpeg or configure GSD_FFMPEG_PATH.', 503, 'MISSING_TOOL');
      selectedClip = validateClipRange(clipRange, info.public.duration);
    }
    let destination = null;
    if (saveToken !== undefined && saveToken !== null) {
      destination = await this.config.resolveDestination?.(saveToken);
      if (!destination || !path.isAbsolute(destination)) throw new ApiError('The save location has expired. Choose a folder again.', 400, 'INVALID_DESTINATION');
      const stat = await fs.stat(destination).catch(() => null);
      if (!stat?.isDirectory()) throw new ApiError('The selected save folder is unavailable. Choose another folder.', 400, 'INVALID_DESTINATION');
    }
    this.checkCapacity();
    const time = this.now();
    const record = { id: crypto.randomUUID(), owner, url: info.public.url, title: info.public.title, thumbnail: info.public.thumbnail, type: option.type, format: option.format, quality: option.quality, status: 'queued', progress: 0, downloadedBytes: 0, totalBytes: option.estimatedSize || null, speedBytes: null, etaSeconds: null, queuePosition: null, attempt: 1, error: null, filename: null, createdAt: time, updatedAt: time, raw: info.raw, option, clipRange: selectedClip, destination, filePath: null, tempDir: null, controller: null, promise: null, transfers: 0 };
    Object.assign(record, { embedThumbnail, thumbnailSidecar, stage: null, warnings: [], thumbnailEmbedded: false, sidecarPath: null, sidecarFilename: null, sidecarDelivered: false, mediaDelivered: false });
    this.jobs.set(record.id, record);
    this.queue.push(record.id);
    this.positions();
    this.pump();
    return this.view(record);
  }

  positions() { this.queue.forEach((id, index) => { const record = this.jobs.get(id); if (record) this.update(record, { queuePosition: index + 1 }); }); }

  pump() {
    while (!this.closed && this.active.size < this.config.concurrency && this.queue.length) {
      const id = this.queue.shift();
      const record = this.jobs.get(id);
      if (!record || record.status !== 'queued') continue;
      this.active.add(id);
      record.controller = new AbortController();
      this.update(record, { status: 'downloading', stage: 'downloading', queuePosition: null });
      record.promise = this.execute(record).finally(() => {
        this.active.delete(id);
        record.controller = null;
        record.promise = null;
        this.positions();
        this.pump();
      });
    }
    this.positions();
  }

  async execute(record) {
    const { signal } = record.controller;
    let copiedPath = null;
    let copiedSidecar = null;
    try {
      record.tempDir = await fs.mkdtemp(path.join(this.runRoot, `${record.id}-${record.attempt}-`));
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      // Refresh signed source URLs after retries or a long wait in the queue.
      if (record.attempt > 1 || this.now() - record.createdAt >= this.config.metadataTtlMs) {
        const info = await withAbort(this.metadata.get(record.url, { refresh: true }), signal);
        const option = info.options.find(value => value.id === record.option.id);
        if (!option) throw new Error('The selected quality has changed. Analyze the link again and choose an available format.');
        if (record.clipRange) validateClipRange(record.clipRange, info.public.duration);
        record.raw = info.raw;
        record.option = option;
      }
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      const output = await this.runner({ config: this.config, raw: record.raw, option: record.option, clipRange: record.clipRange, tempDir: record.tempDir, signal, embedThumbnail: record.embedThumbnail, thumbnailSidecar: record.thumbnailSidecar, onProgress: patch => {
        if (!signal.aborted) this.update(record, patch);
      } });
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      const extension = path.extname(output.filePath).slice(1).toLowerCase();
      if (!/^[a-z0-9]{2,8}$/.test(extension)) throw new Error('The source returned an unsupported file extension.');
      const filename = safeFilename(record.title, extension, record.id);
      const warnings = [...(output.warnings || [])];
      let sidecarFilename = null;
      if (output.sidecarPath) {
        const imageExtension = path.extname(output.sidecarPath).slice(1).toLowerCase();
        if (!['jpg', 'jpeg', 'png'].includes(imageExtension) || path.dirname(path.resolve(output.sidecarPath)) !== path.resolve(record.tempDir)) throw new Error('The thumbnail tool returned an invalid output path.');
        sidecarFilename = `${path.parse(filename).name}.${imageExtension}`;
      }
      this.update(record, { status: 'processing', stage: 'finalizing', speedBytes: null, etaSeconds: null });
      if (record.destination) {
        copiedPath = path.join(record.destination, filename);
        try { await fs.copyFile(output.filePath, copiedPath, constants.COPYFILE_EXCL); }
        catch (error) {
          copiedPath = null;
          if (error.code === 'EEXIST') throw new Error('A file with this download name already exists. Choose another folder or remove it before retrying.');
          throw new Error('Unable to save to the selected folder. Check available space and write permission.');
        }
        if (output.sidecarPath) {
          const target = path.join(record.destination, sidecarFilename);
          try {
            await fs.copyFile(output.sidecarPath, target, constants.COPYFILE_EXCL);
            copiedSidecar = target;
          } catch {
            warnings.push('The media was saved, but its separate thumbnail could not be saved. Check the folder permission, free space and existing thumbnail filename.');
          }
        }
        if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        await this.cleanup(record);
      } else {
        record.filePath = output.filePath;
        record.sidecarPath = output.sidecarPath || null;
      }
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      this.update(record, { status: 'completed', stage: 'completed', progress: 100, downloadedBytes: output.size, totalBytes: output.size, speedBytes: null, etaSeconds: null, filename, error: null, warnings, thumbnailEmbedded: output.thumbnailEmbedded === true, sidecarFilename: copiedPath && !copiedSidecar ? null : sidecarFilename, sidecarDelivered: Boolean(copiedSidecar), ...(copiedPath ? { savedPath: copiedPath } : {}), ...(copiedSidecar ? { sidecarSavedPath: copiedSidecar } : {}) });
      record.raw = null;
    } catch (error) {
      if (copiedPath) await fs.rm(copiedPath, { force: true }).catch(() => {});
      if (copiedSidecar) await fs.rm(copiedSidecar, { force: true }).catch(() => {});
      const cancelled = signal.aborted || error.name === 'AbortError';
      let cleanupError = null;
      try { await this.cleanup(record); } catch { cleanupError = ' Some temporary files are still in use; GSD will try cleaning them again.'; }
      this.update(record, { status: cancelled ? 'cancelled' : 'failed', stage: null, error: cleanupError ? `${cancelled ? 'Download cancelled.' : error.message}${cleanupError}` : cancelled ? null : error.message, queuePosition: null, speedBytes: null, etaSeconds: null });
    }
  }

  async cleanup(record) {
    if (record.tempDir) await fs.rm(record.tempDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    record.tempDir = null;
    record.filePath = null;
    record.sidecarPath = null;
  }

  async cancel(id, owner) {
    const record = this.owned(id, owner);
    if (!ACTIVE.has(record.status)) throw new ApiError('Only queued or active downloads can be cancelled.', 409, 'INVALID_STATE');
    this.queue = this.queue.filter(value => value !== id);
    record.controller?.abort();
    this.update(record, { status: 'cancelled', stage: null, queuePosition: null, error: null, speedBytes: null, etaSeconds: null });
    this.positions();
    if (!this.active.has(id)) this.pump();
    if (record.promise) await record.promise;
    return this.view(record);
  }

  async retry(id, owner) {
    const record = this.owned(id, owner);
    if (!['failed', 'cancelled'].includes(record.status) || this.active.has(id)) throw new ApiError('Wait until this download has stopped before retrying.', 409, 'INVALID_STATE');
    this.checkCapacity();
    this.update(record, { status: 'queued', stage: null, attempt: record.attempt + 1, progress: 0, downloadedBytes: 0, totalBytes: record.option.estimatedSize || null, speedBytes: null, etaSeconds: null, error: null, filename: null, warnings: [], thumbnailEmbedded: false, sidecarFilename: null, sidecarDelivered: false, mediaDelivered: false, deliveryAcknowledged: false });
    try { await this.cleanup(record); }
    catch { this.update(record, { status: 'failed', error: 'The previous attempt still has files in use. Wait a moment, then retry.' }); throw new ApiError('The previous attempt still has files in use. Wait a moment, then retry.', 409, 'CLEANUP_PENDING'); }
    if (record.status !== 'queued' || this.closed) return this.view(record);
    this.queue.push(id);
    this.positions();
    this.pump();
    return this.view(record);
  }

  beginDelivery(id, owner, kind = 'media') {
    const record = this.owned(id, owner);
    const available = kind === 'thumbnail' ? ['completed', 'delivered'].includes(record.status) && record.sidecarPath : record.status === 'completed' && record.filePath;
    if (!available) throw new ApiError(record.savedPath ? 'This file has already been saved to your selected folder.' : 'The file is not available. It may have been delivered or expired.', 409, 'FILE_UNAVAILABLE');
    record.transfers++;
    return record;
  }

  async finishDelivery(record, success, kind = 'media') {
    record.transfers = Math.max(0, record.transfers - 1);
    if (success) {
      if (kind === 'thumbnail') record.sidecarDelivered = true;
      else record.mediaDelivered = true;
    }
    await this.settleDelivery(record);
  }

  async settleDelivery(record) {
    record.settling = (record.settling || 0) + 1;
    try {
      if (record.transfers) return;
      const mediaDone = record.mediaDelivered || record.deliveryAcknowledged;
      if (mediaDone && (!record.sidecarPath || record.sidecarDelivered)) await this.cleanup(record);
      if (mediaDone) this.update(record, { status: 'delivered', sidecarDelivered: record.sidecarDelivered });
      else if (record.sidecarDelivered) this.update(record, { sidecarDelivered: true });
    } finally { record.settling--; }
  }

  async acknowledgeDelivery(id, owner) {
    const record = this.owned(id, owner);
    if (record.status === 'delivered') return this.view(record);
    if (record.status !== 'completed' || record.savedPath) throw new ApiError('This download is not awaiting browser delivery.', 409, 'INVALID_STATE');
    record.deliveryAcknowledged = true;
    await this.settleDelivery(record);
    return this.view(record);
  }

  async sweep() {
    for (const [id, record] of this.jobs) {
      if (ACTIVE.has(record.status) || this.active.has(id) || record.transfers || record.settling || this.now() - record.updatedAt < this.config.terminalTtlMs) continue;
      record.expiring = true;
      await this.cleanup(record);
      this.jobs.delete(id);
      this.events.emit(id, { ...this.view(record), expired: true });
      this.events.emit('change', record.owner, { ...this.view(record), expired: true });
      this.events.removeAllListeners(id);
    }
  }

  async close() {
    this.closed = true;
    clearInterval(this.sweeper);
    this.queue.length = 0;
    for (const record of this.jobs.values()) record.controller?.abort();
    await Promise.allSettled([...this.jobs.values()].map(record => record.promise).filter(Boolean));
    await Promise.allSettled([...this.jobs.values()].map(record => this.cleanup(record)));
    this.events.removeAllListeners();
    if (this.runRoot) await fs.rm(this.runRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
}

module.exports = { DownloadManager, safeFilename, validateClipRange, ACTIVE };
