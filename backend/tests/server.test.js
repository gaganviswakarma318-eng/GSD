const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { startServer } = require("../server");

test("Instagram APIs inspect public media and queue selected items through the shared manager", async (t) => {
  const mediaInfo = {
    public: {
      url: "https://www.instagram.com/p/ABC/",
      title: "Public photo",
      thumbnail: "https://scontent.cdninstagram.com/photo.jpg",
      duration: null,
    },
    raw: { formats: [] },
    options: [
      {
        id: "image-format",
        type: "image",
        format: "jpg",
        quality: "Original",
        selector: "instagram-image-0",
      },
    ],
  };
  const extracted = {
    url: "https://www.instagram.com/p/ABC/",
    items: [
      { id: "0:photo", info: mediaInfo },
      { id: "1:photo", info: mediaInfo },
    ],
  };
  const queued = [];
  const manager = {
    active: new Set(),
    queue: [],
    events: new EventEmitter(),
    async initialize() {},
    async close() {},
    list() {
      return [];
    },
    async createFromInfo(info, options, owner, source) {
      queued.push({ info, options, owner, source });
      return {
        id: `queued-image-${queued.length}`,
        type: "image",
        source: "instagram",
        status: "queued",
      };
    },
    hasActive() {
      return false;
    },
  };
  const instagram = {
    async inspect(url) {
      return { url, contentType: "photo", items: [] };
    },
    async extract(url) {
      return { ...extracted, url };
    },
    async prepareDownload(_url, itemId, optionId) {
      assert.ok(["0:photo", "1:photo"].includes(itemId));
      assert.equal(optionId, "image-format");
      return { info: mediaInfo, refresh: async () => mediaInfo };
    },
    async close() {},
  };
  const instance = await startServer({
    port: 0,
    tempRoot: `/tmp/gsd-instagram-server-test-${process.pid}`,
    frontendPath: "/missing",
    availability: { ytDlp: true, ffmpeg: true, ffprobe: true },
    metadata: { async close() {} },
    manager,
    instagram,
  });
  t.after(() => instance.close());

  const inspectResponse = await fetch(`${instance.url}/api/instagram/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://www.instagram.com/p/ABC/" }),
  });
  assert.equal(inspectResponse.status, 200);
  assert.equal((await inspectResponse.json()).contentType, "photo");

  const queueResponse = await fetch(`${instance.url}/api/instagram/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://www.instagram.com/p/ABC/",
      items: [
        { itemId: "0:photo", optionId: "image-format" },
        { itemId: "1:photo", optionId: "image-format" },
      ],
    }),
  });
  assert.equal(queueResponse.status, 201);
  const result = await queueResponse.json();
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(queued[0].options.embedThumbnail, false);
  assert.equal(queued[0].source.source, "instagram");
  assert.equal(typeof queued[0].source.refreshMetadata, "function");
});
