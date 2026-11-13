const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  PreviewManager,
  PREVIEW_FORMAT,
  MAX_PREVIEW_BYTES,
} = require("../services/previewManager");
const { createConfig } = require("../config");

const info = {
  public: {
    url: "https://example.com/video",
    duration: 30,
  },
  raw: {
    formats: [{ format_id: "video", vcodec: "avc1", acodec: "none" }],
  },
};

async function fixture(t, processRunner, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gsd-preview-test-"));
  const config = createConfig({
    tempRoot: root,
    cleanupIntervalMs: 60000,
    ...options,
  });
  const metadata = {
    availability: { ffmpeg: true },
    async get() {
      return info;
    },
  };
  const manager = new PreviewManager(config, metadata, { processRunner, ...options });
  await manager.initialize();
  t.after(() => manager.close());
  return { manager, root };
}

test("preview downloads a capped video, serves it only to its owner, and cleans it up", async (t) => {
  const { manager } = await fixture(t, async (_command, args, options) => {
    assert.ok(args.includes(PREVIEW_FORMAT));
    assert.ok(args.includes("512M"));
    const filePath = path.join(options.cwd, "preview.mp4");
    await fs.writeFile(filePath, "preview video");
    options.onLine(`GSD_FILE:${JSON.stringify(filePath)}`);
    options.onLine("[download] 40.0% of ~10MiB");
    return { code: 0, stdout: "", stderr: "" };
  });
  const preview = await manager.create(info.public.url, "owner");
  await manager.previews.get(preview.id).promise;
  assert.equal(manager.get(preview.id, "owner").status, "ready");
  assert.equal(manager.get(preview.id, "owner").progress, 100);
  assert.throws(() => manager.get(preview.id, "another-owner"), {
    code: "NOT_FOUND",
  });
  const record = manager.beginDelivery(preview.id, "owner");
  assert.equal(await fs.readFile(record.filePath, "utf8"), "preview video");
  await manager.finishDelivery(record);
  await manager.remove(preview.id, "owner");
  await assert.rejects(fs.access(record.directory));
});

test("preview extraction failures are shown as errors", async (t) => {
  const { manager } = await fixture(t, async () => ({
    code: 1,
    stdout: "",
    stderr: "ERROR: source blocked",
  }));
  const preview = await manager.create(info.public.url, "owner");
  await manager.previews.get(preview.id).promise;
  const status = manager.get(preview.id, "owner");
  assert.equal(status.status, "failed");
  assert.equal(status.error, "source blocked");
});

test("oversized video previews are rejected", async (t) => {
  const { manager } = await fixture(t, async (_command, _args, options) => {
    const filePath = path.join(options.cwd, "preview.mp4");
    await fs.writeFile(filePath, "");
    await fs.truncate(filePath, MAX_PREVIEW_BYTES + 1);
    options.onLine(`GSD_FILE:${JSON.stringify(filePath)}`);
    return { code: 0, stdout: "", stderr: "" };
  });
  const preview = await manager.create(info.public.url, "owner");
  await manager.previews.get(preview.id).promise;
  assert.equal(manager.get(preview.id, "owner").status, "failed");
  assert.match(manager.get(preview.id, "owner").error, /512 MB limit/);
});

test("deleting a preparing preview cancels its media process", async (t) => {
  let aborted = false;
  const { manager } = await fixture(
    t,
    (_command, _args, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
          },
          { once: true },
        );
      }),
  );
  const preview = await manager.create(info.public.url, "owner");
  await manager.remove(preview.id, "owner");
  assert.equal(aborted, true);
  assert.equal(manager.previews.has(preview.id), false);
});

test("deleting a preview waits for its active video transfer before cleanup", async (t) => {
  const { manager } = await fixture(t, async (_command, _args, options) => {
    const filePath = path.join(options.cwd, "preview.webm");
    await fs.writeFile(filePath, "preview video");
    options.onLine(`GSD_FILE:${JSON.stringify(filePath)}`);
    return { code: 0, stdout: "", stderr: "" };
  });
  const preview = await manager.create(info.public.url, "owner");
  await manager.previews.get(preview.id).promise;
  const record = manager.beginDelivery(preview.id, "owner");
  await manager.remove(preview.id, "owner");
  assert.equal(await fs.readFile(record.filePath, "utf8"), "preview video");
  assert.equal(manager.previews.has(preview.id), true);
  await manager.finishDelivery(record);
  assert.equal(manager.previews.has(preview.id), false);
  await assert.rejects(fs.access(record.directory));
});
