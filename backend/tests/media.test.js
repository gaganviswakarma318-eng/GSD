const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOptions } = require("../services/formats");
const { buildArgs, parseProgress } = require("../services/downloader");
const { MetadataService } = require("../services/metadata");
const {
  mediaError,
  validateUrl,
  validatePublicUrl,
  privateAddress,
} = require("../utils/errors");
const { runProcess } = require("../utils/processes");
const { createConfig } = require("../config");

const formats = [
  {
    format_id: "a",
    url: "https://example.com/a",
    ext: "m4a",
    acodec: "mp4a.40.2",
    vcodec: "none",
    abr: 128,
    filesize: 100,
  },
  {
    format_id: "v",
    url: "https://example.com/v",
    ext: "mp4",
    acodec: "none",
    vcodec: "avc1",
    height: 1080,
    tbr: 2000,
    filesize: 1000,
  },
  {
    format_id: "22",
    url: "https://example.com/22",
    ext: "mp4",
    acodec: "mp4a.40.2",
    vcodec: "avc1",
    height: 720,
    tbr: 1000,
  },
  {
    format_id: "drm",
    url: "https://example.com/drm",
    ext: "mp4",
    acodec: "mp4a",
    vcodec: "avc1",
    height: 2160,
    has_drm: true,
  },
];
const raw = { title: "Test", duration: 12, formats };

test("quality choices represent available streams, compatible merges, and MP3 conversion only", () => {
  const available = buildOptions(raw, { ffmpeg: true });
  assert.equal(available.length, 4);
  const mp3 = available.find((option) => option.format === "mp3");
  assert.equal(mp3.selector, "a");
  assert.equal(mp3.requiresConversion, true);
  const merged = available.find((option) => option.quality === "1080p");
  assert.equal(merged.selector, "v+a");
  assert.equal(merged.estimatedSize, 1100);
  assert.equal(merged.requiresConversion, false);
  assert.ok(!available.some((option) => option.quality === "2160p"));
  const withoutFfmpeg = buildOptions(raw, { ffmpeg: false });
  assert.equal(withoutFfmpeg.length, 2);
  assert.ok(
    !withoutFfmpeg.some((option) => option.merged || option.format === "mp3"),
  );
  assert.ok(
    !buildOptions({
      formats: [
        { ...formats[1], ext: "mp4" },
        { ...formats[0], acodec: "opus", ext: "webm" },
      ],
    }).some((option) => option.type === "video"),
  );
});

test("download args use pinned source IDs and cached metadata; only MP3 transcodes", () => {
  const config = createConfig({
    tools: { node: "C:\\Tools\\node.exe", ffmpeg: "C:\\Tools\\ffmpeg.exe" },
  });
  const available = buildOptions(raw);
  const mp4 = buildArgs(
    config,
    available.find((option) => option.quality === "1080p"),
    "source.json",
    "temp",
  );
  assert.ok(mp4.includes("v+a"));
  assert.ok(mp4.includes("--load-info-json"));
  assert.equal(mp4[mp4.indexOf("--output") + 1], "media.%(ext)s");
  assert.ok(
    !mp4.includes("--trim-filenames"),
    "fixed output names must not truncate the Windows directory path",
  );
  assert.ok(mp4.includes("--ffmpeg-location"));
  assert.ok(!mp4.includes("--recode-video"));
  assert.ok(!mp4.includes("--extract-audio"));
  const mp3 = buildArgs(
    config,
    available.find((option) => option.format === "mp3"),
    "source.json",
    "temp",
  );
  assert.ok(mp3.includes("--extract-audio"));
  assert.ok(mp3.includes("node:C:\\Tools\\node.exe"));
  assert.equal(mp3[mp3.indexOf("--audio-format") + 1], "mp3");
  const clip = buildArgs(
    config,
    available.find((option) => option.quality === "1080p"),
    "source.json",
    "temp",
    { startSeconds: 12.25, endSeconds: 27 },
  );
  assert.equal(
    clip[clip.indexOf("--download-sections") + 1],
    "*12.25-27",
  );
  assert.ok(clip.includes("--force-keyframes-at-cuts"));
});

test("clip extraction failures explain unsupported sources and missing FFmpeg", () => {
  assert.match(
    mediaError("ERROR: This extractor does not support downloading sections"),
    /does not support clip downloads/,
  );
  assert.match(
    mediaError("ERROR: ffmpeg is not installed"),
    /require FFmpeg/,
  );
});

test("yt-dlp discovers FFmpeg from PATH when configured by command name", () => {
  const config = createConfig({ tools: { ffmpeg: "ffmpeg" } });
  const args = buildArgs(
    config,
    buildOptions(raw).find((option) => option.quality === "1080p"),
    "source.json",
    "temp",
  );
  assert.ok(!args.includes("--ffmpeg-location"));
  assert.ok(args.includes("--merge-output-format"));
});

test("browser cookies are opt-in and passed as a separate yt-dlp argument", () => {
  const config = createConfig({ cookiesFromBrowser: "firefox" });
  const args = buildArgs(
    config,
    buildOptions(raw).find((option) => option.quality === "1080p"),
    "source.json",
    "temp",
  );
  assert.equal(args[args.indexOf("--cookies-from-browser") + 1], "firefox");
  assert.ok(!buildArgs(
    createConfig({ cookiesFromBrowser: "" }),
    buildOptions(raw).find((option) => option.quality === "1080p"),
    "source.json",
    "temp",
  ).includes("--cookies-from-browser"));
});

test("progress parses machine JSON across unavailable fields and rejects malformed output", () => {
  const progress = parseProgress(
    'GSD_PROGRESS:{"downloaded_bytes":50,"total_bytes":100,"speed":25,"eta":2,"format_id":"v","status":"downloading"}',
  );
  assert.equal(progress.progress, 50);
  assert.equal(progress.speedBytes, 25);
  assert.equal(progress.streamId, "v");
  assert.equal(parseProgress("GSD_PROGRESS:invalid"), null);
  assert.equal(parseProgress("[download] 50%"), null);
});

test("URL validation rejects unsafe protocols, credentials, loopback, and private networks", async () => {
  assert.throws(() => validateUrl("file:///secret"));
  assert.throws(() => validateUrl("https://user:pass@example.com/video"));
  for (const address of [
    "127.0.0.1",
    "10.1.1.1",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.ok(privateAddress(address));
  assert.ok(!privateAddress("8.8.8.8"));
  await assert.rejects(validatePublicUrl("http://localhost/test"));
  await assert.rejects(validatePublicUrl("http://127.0.0.1/test"));
  assert.equal(
    await validatePublicUrl("http://127.0.0.1/test", true),
    "http://127.0.0.1/test",
  );
});

test("metadata is deduplicated, cached, and bounded to two simultaneous lookups", async (t) => {
  let active = 0,
    maxActive = 0,
    calls = 0;
  const gates = [];
  const config = createConfig({ allowPrivateUrls: true });
  const metadata = new MetadataService(
    config,
    { ytDlp: true, ffmpeg: true },
    {
      processRunner: async () => {
        calls++;
        active++;
        maxActive = Math.max(active, maxActive);
        await new Promise((resolve) => gates.push(resolve));
        active--;
        return { code: 0, stdout: JSON.stringify(raw), stderr: "" };
      },
    },
  );
  t.after(() => metadata.close());
  const first = metadata.get("https://example.com/one");
  const duplicate = metadata.get("https://example.com/one");
  const second = metadata.get("https://example.com/two");
  const third = metadata.get("https://example.com/three");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  gates.shift()();
  gates.shift()();
  await Promise.all([first, duplicate, second]);
  await new Promise((resolve) => setImmediate(resolve));
  gates.shift()();
  await third;
  assert.equal(calls, 3);
  assert.equal(maxActive, 2);
  await metadata.get("https://example.com/one");
  assert.equal(calls, 3);
});

test("cancellation stops a real child process tree on this operating system", async () => {
  const controller = new AbortController();
  let childPid;
  const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); console.log('CHILD:'+child.pid); setInterval(()=>{},1000);`;
  const pending = runProcess(process.execPath, ["-e", script], {
    signal: controller.signal,
    timeoutMs: 5000,
    onLine(line) {
      if (line.startsWith("CHILD:")) {
        childPid = Number(line.slice(6));
        controller.abort();
      }
    },
  });
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.ok(childPid);
  assert.throws(
    () => process.kill(childPid, 0),
    (error) => error.code === "ESRCH",
  );
});
