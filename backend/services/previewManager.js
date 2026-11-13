const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { runProcess } = require("../utils/processes");
const { ApiError, mediaError } = require("../utils/errors");
const { commonArgs } = require("./metadata");

const PREVIEW_FORMAT =
  "best[height<=480][vcodec!=none]/bestvideo[height<=480]+bestaudio/best[height<=480][vcodec!=none]/bestvideo[height<=480]/best[vcodec!=none]";
const PREVIEW_EXTENSIONS = new Set([".mp4", ".webm", ".mkv", ".mov", ".ogv"]);
const MAX_PREVIEW_BYTES = 512 * 1024 * 1024;

class PreviewManager {
  constructor(
    config,
    metadata,
    { processRunner = runProcess, now = Date.now, ttlMs = 15 * 60 * 1000 } = {},
  ) {
    this.config = config;
    this.metadata = metadata;
    this.processRunner = processRunner;
    this.now = now;
    this.ttlMs = ttlMs;
    this.previews = new Map();
    this.closed = false;
  }

  async initialize() {
    await fs.mkdir(this.config.tempRoot, { recursive: true });
    this.runRoot = await fs.mkdtemp(
      path.join(this.config.tempRoot, "gsd-preview-"),
    );
    this.sweeper = setInterval(() => void this.sweep(), 60 * 1000);
    this.sweeper.unref();
  }

  view(record) {
    return {
      id: record.id,
      status: record.status,
      progress: record.progress,
      error: record.error,
      duration: record.duration,
    };
  }

  owned(id, owner) {
    const record = this.previews.get(id);
    if (!record || record.owner !== owner || record.expiring)
      throw new ApiError("This video preview was not found or has expired.", 404, "NOT_FOUND");
    record.updatedAt = this.now();
    return record;
  }

  async create(url, owner) {
    if (this.closed) throw new ApiError("GSD is shutting down.", 503);
    if (this.metadata.availability?.ffmpeg === false)
      throw new ApiError(
        "Video preview requires FFmpeg. Install FFmpeg or configure GSD_FFMPEG_PATH.",
        503,
        "MISSING_TOOL",
      );
    const active = [...this.previews.values()].filter(
      (record) => record.status === "preparing" && !record.expiring,
    ).length;
    if (active >= 2)
      throw new ApiError(
        "Video previews are busy. Try again when another preview is ready.",
        429,
        "PREVIEW_BUSY",
      );

    const info = await this.metadata.get(url);
    if (this.closed) throw new ApiError("GSD is shutting down.", 503);
    if (
      [...this.previews.values()].filter(
        (record) => record.status === "preparing" && !record.expiring,
      ).length >= 2
    )
      throw new ApiError(
        "Video previews are busy. Try again when another preview is ready.",
        429,
        "PREVIEW_BUSY",
      );
    const formats = Array.isArray(info.raw?.formats)
      ? info.raw.formats
      : [info.raw || {}];
    if (!formats.some((format) => format.vcodec && format.vcodec !== "none"))
      throw new ApiError("This source has no playable video preview.", 422, "PREVIEW_UNAVAILABLE");

    const id = crypto.randomUUID();
    const directory = path.join(this.runRoot, id);
    await fs.mkdir(directory);
    const record = {
      id,
      owner,
      url: info.public.url,
      duration: info.public.duration,
      directory,
      filePath: null,
      status: "preparing",
      progress: 0,
      error: null,
      updatedAt: this.now(),
      transfers: 0,
      expiring: false,
      controller: new AbortController(),
      promise: null,
    };
    this.previews.set(id, record);
    record.promise = this.prepare(record);
    return this.view(record);
  }

  async prepare(record) {
    let filePath = null;
    try {
      const args = [
        ...commonArgs(this.config),
        "--no-playlist",
        "--no-warnings",
        "--no-colors",
        "--no-simulate",
        "--no-overwrites",
        "--max-filesize",
        "512M",
        "--format",
        PREVIEW_FORMAT,
        "--paths",
        record.directory,
        "--output",
        "preview.%(ext)s",
        "--print",
        "after_move:GSD_FILE:%(filepath)j",
        "--",
        record.url,
      ];
      const ffmpeg = this.config.tools.ffmpeg;
      if (ffmpeg && (/[\\/]/.test(ffmpeg) || /^[A-Za-z]:/.test(ffmpeg)))
        args.splice(args.indexOf("--"), 0, "--ffmpeg-location", ffmpeg);
      const result = await this.processRunner(this.config.tools.ytDlp, args, {
        signal: record.controller.signal,
        timeoutMs: 15 * 60 * 1000,
        cwd: record.directory,
        captureStdout: false,
        onLine: (line) => {
          if (line.startsWith("GSD_FILE:")) {
            try {
              filePath = JSON.parse(line.slice("GSD_FILE:".length));
            } catch {
              filePath = null;
            }
          }
          const progress = /\[download\]\s+([\d.]+)%/.exec(line);
          if (progress) {
            const value = Number(progress[1]);
            if (Number.isFinite(value))
              record.progress = Math.min(99, Math.max(0, value));
          }
        },
      });
      if (result.code !== 0) throw new Error(mediaError(result.stderr));
      const resolved = path.resolve(filePath || "");
      const expectedParent = path.resolve(record.directory);
      if (
        path.dirname(resolved) !== expectedParent ||
        !PREVIEW_EXTENSIONS.has(path.extname(resolved).toLowerCase())
      )
        throw new Error("The media tool did not produce a playable video preview.");
      const stat = await fs.stat(resolved);
      if (!stat.isFile() || !stat.size)
        throw new Error("The media tool produced an empty video preview.");
      if (stat.size > MAX_PREVIEW_BYTES)
        throw new Error(
          "The video preview exceeded the 512 MB limit. Try a shorter source.",
        );
      record.filePath = resolved;
      record.progress = 100;
      record.status = "ready";
    } catch (error) {
      if (record.controller.signal.aborted) {
        record.status = "cancelled";
      } else {
        record.status = "failed";
        record.error =
          error instanceof Error ? error.message : "The video preview failed.";
      }
    } finally {
      record.controller = null;
      if (record.expiring && !record.transfers) await this.cleanup(record);
    }
  }

  get(id, owner) {
    return this.view(this.owned(id, owner));
  }

  beginDelivery(id, owner) {
    const record = this.owned(id, owner);
    if (record.status !== "ready" || !record.filePath)
      throw new ApiError("The video preview is not ready yet.", 409, "PREVIEW_NOT_READY");
    record.transfers++;
    return record;
  }

  async finishDelivery(record) {
    record.transfers = Math.max(0, record.transfers - 1);
    if (record.expiring && !record.transfers) await this.cleanup(record);
  }

  async remove(id, owner) {
    const record = this.owned(id, owner);
    record.expiring = true;
    record.controller?.abort();
    if (record.promise) await record.promise;
    if (!record.transfers) await this.cleanup(record);
    return { removed: true };
  }

  async cleanup(record) {
    if (record.transfers) return;
    await fs.rm(record.directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
    this.previews.delete(record.id);
  }

  async sweep() {
    for (const record of this.previews.values()) {
      if (this.now() - record.updatedAt < this.ttlMs) continue;
      record.expiring = true;
      record.controller?.abort();
      if (record.promise) await record.promise;
      if (!record.transfers) await this.cleanup(record);
    }
  }

  async close() {
    this.closed = true;
    clearInterval(this.sweeper);
    for (const record of this.previews.values()) {
      record.expiring = true;
      record.controller?.abort();
    }
    await Promise.allSettled(
      [...this.previews.values()].map((record) => record.promise).filter(Boolean),
    );
    for (const record of this.previews.values()) {
      record.transfers = 0;
      await this.cleanup(record);
    }
    await fs.rm(this.runRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
}

module.exports = { PreviewManager, PREVIEW_FORMAT, MAX_PREVIEW_BYTES };
