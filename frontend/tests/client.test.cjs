const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

// Exercise the actual TypeScript client with controlled browser primitives.
const source =
  "const API_BASE = '/api';\n" +
  stripTypeScriptTypes(
    fs
      .readFileSync(path.join(__dirname, "../src/api/client.ts"), "utf8")
      .replace(/^import .*$/gm, ""),
    { mode: "strip" },
  ).replace(/^export /gm, "") +
  "\nmodule.exports = { api, saveToHandle, downloadInBrowser, downloadThumbnailInBrowser };";
function client(fetch, document) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    exports: module.exports,
    module,
    require: () => ({ API_BASE: "/api" }),
    fetch,
    document,
    DOMException,
    Uint8Array,
    Error,
  });
  return module.exports;
}
const json = (body) => ({ ok: true, json: async () => body });

test("initial API requests share one session handshake before parallel calls", async () => {
  const calls = [];
  let release;
  const first = new Promise((resolve) => {
    release = resolve;
  });
  const { api } = client(async (url) => {
    calls.push(url);
    if (calls.length === 1) return first;
    return json(url.endsWith("/jobs") ? [] : { tools: {} });
  });
  const pending = Promise.all([api.jobs(), api.health()]);
  assert.deepEqual(calls, ["/api/health"]);
  release(json({ tools: {} }));
  await pending;
  assert.deepEqual(calls, ["/api/health", "/api/jobs", "/api/health"]);
});

test("job creation preserves thumbnail preferences and the existing save destination", async () => {
  const calls = [];
  const { api } = client(async (url, options) => {
    calls.push({ url, options });
    return json({ id: "job" });
  });
  await api.create("https://example.com/media", "mp4", "folder", {
    embedThumbnail: true,
    thumbnailSidecar: false,
  });
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    url: "https://example.com/media",
    optionId: "mp4",
    saveToken: "folder",
    embedThumbnail: true,
    thumbnailSidecar: false,
  });
  await api.create("https://example.com/media", "webm", undefined, {
    embedThumbnail: false,
    thumbnailSidecar: true,
  });
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    url: "https://example.com/media",
    optionId: "webm",
    embedThumbnail: false,
    thumbnailSidecar: true,
  });
  await api.create("https://example.com/media", "mp3");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    url: "https://example.com/media",
    optionId: "mp3",
  });
  await api.create(
    "https://example.com/media",
    "mp4",
    undefined,
    undefined,
    { startSeconds: 12, endSeconds: 27 },
  );
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    url: "https://example.com/media",
    optionId: "mp4",
    clipRange: { startSeconds: 12, endSeconds: 27 },
  });
});

test("saving an optional thumbnail uses its own encoded route and filename", () => {
  const operations = [];
  const link = {
    click: () => operations.push("click"),
    remove: () => operations.push("remove"),
  };
  const { api, downloadThumbnailInBrowser } = client(async () => json({}), {
    createElement: (tag) => {
      assert.equal(tag, "a");
      return link;
    },
    body: { append: (element) => operations.push(element) },
  });
  downloadThumbnailInBrowser({ id: "job/1", sidecarFilename: "My media.jpg" });
  assert.equal(api.thumbnailUrl("job/1"), "/api/jobs/job%2F1/thumbnail");
  assert.equal(link.href, "/api/jobs/job%2F1/thumbnail");
  assert.equal(link.download, "My media.jpg");
  assert.deepEqual(operations, [link, "click", "remove"]);
});

test("denied writable handle cancels response body without acknowledging delivery", async () => {
  let cancelled = false;
  const calls = [];
  const { saveToHandle } = client(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers["X-GSD-Delivery-Ack"], "manual");
    return {
      ok: true,
      body: {
        cancel: async () => {
          cancelled = true;
        },
      },
    };
  });
  await assert.rejects(
    saveToHandle("job", {
      createWritable: async () => {
        throw new Error("Permission denied");
      },
    }),
    /Permission denied/,
  );
  assert.equal(cancelled, true);
  assert.deepEqual(calls, ["/api/jobs/job/file"]);
});

test("stream write failure aborts disk write and releases the reader", async () => {
  const operations = [];
  const reader = {
    read: async () => ({ done: false, value: new Uint8Array([1, 2]) }),
    cancel: async () => operations.push("cancel"),
    releaseLock: () => operations.push("release"),
  };
  const { saveToHandle } = client(async () => ({
    ok: true,
    body: { getReader: () => reader },
  }));
  await assert.rejects(
    saveToHandle("job", {
      createWritable: async () => ({
        write: async () => {
          throw new Error("Disk full");
        },
        abort: async () => operations.push("abort"),
        close: async () => operations.push("close"),
      }),
    }),
    /Disk full/,
  );
  assert.deepEqual(operations, ["abort", "cancel", "release"]);
});

test("delivery acknowledgement follows committed disk write and safely retries", async () => {
  const operations = [];
  let reads = 0;
  let acknowledgements = 0;
  const reader = {
    read: async () =>
      reads++ ? { done: true } : { done: false, value: new Uint8Array([1, 2]) },
    cancel: async () => operations.push("cancel"),
    releaseLock: () => operations.push("release"),
  };
  const { saveToHandle } = client(async (url) => {
    if (url.endsWith("/file"))
      return { ok: true, body: { getReader: () => reader } };
    if (url.endsWith("/delivered")) {
      operations.push("ack");
      if (++acknowledgements === 1) throw new Error("Temporary disconnection");
    }
    return json({ status: "delivered" });
  });
  const result = await saveToHandle("job", {
    createWritable: async () => ({
      write: async (bytes) => {
        assert.deepEqual([...bytes], [1, 2]);
        operations.push("write");
      },
      abort: async () => operations.push("abort"),
      close: async () => operations.push("close"),
    }),
  });
  assert.equal(result.acknowledged, true);
  assert.deepEqual(operations, ["write", "close", "release", "ack", "ack"]);
});
