const path = require("node:path");
const os = require("node:os");

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function createConfig(options = {}) {
  const binaries =
    process.env.GSD_BINARIES_DIR || path.join(__dirname, "binaries");
  const exe = process.platform === "win32" ? ".exe" : "";
  const fs = require("node:fs");
  const tool = (name, envName) =>
    process.env[envName] ||
    (fs.existsSync(path.join(binaries, name + exe))
      ? path.join(binaries, name + exe)
      : name + exe);
  return {
    ...options,
    host: options.host || "127.0.0.1",
    port: integer(options.port ?? process.env.PORT, 3000, 0, 65535),
    frontendPath: path.resolve(
      options.frontendPath || path.resolve(__dirname, "../dist/frontend"),
    ),
    tempRoot: path.resolve(
      options.tempRoot ||
        process.env.GSD_TEMP_DIR ||
        path.join(os.tmpdir(), "GSD"),
    ),
    concurrency: integer(
      options.concurrency ?? process.env.GSD_CONCURRENCY,
      2,
      1,
      4,
    ),
    maxPending: integer(
      options.maxPending ?? process.env.GSD_MAX_PENDING,
      20,
      1,
      100,
    ),
    terminalTtlMs: integer(
      options.terminalTtlMs,
      60 * 60 * 1000,
      1,
      7 * 24 * 60 * 60 * 1000,
    ),
    cleanupIntervalMs: integer(
      options.cleanupIntervalMs,
      60 * 1000,
      5,
      60 * 60 * 1000,
    ),
    metadataTtlMs: integer(
      options.metadataTtlMs,
      10 * 60 * 1000,
      1,
      60 * 60 * 1000,
    ),
    metadataTimeoutMs: integer(
      options.metadataTimeoutMs,
      60 * 1000,
      100,
      5 * 60 * 1000,
    ),
    maxMetadataEntries: integer(options.maxMetadataEntries, 100, 1, 500),
    metadataConcurrency: integer(options.metadataConcurrency, 2, 1, 4),
    allowPrivateUrls: options.allowPrivateUrls === true,
    cookiesFromBrowser:
      options.cookiesFromBrowser ?? process.env.GSD_COOKIES_FROM_BROWSER ?? "",
    resolveDestination: options.resolveDestination,
    // Preserve complete defaults even when only some tools are overridden.
    tools: {
      ytDlp: tool("yt-dlp", "GSD_YTDLP_PATH"),
      ffmpeg: tool("ffmpeg", "GSD_FFMPEG_PATH"),
      ffprobe: tool("ffprobe", "GSD_FFPROBE_PATH"),
      node: process.env.GSD_NODE_PATH || process.execPath,
      ...options.tools,
    },
  };
}

module.exports = { createConfig };
