const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transformWithOxc } = require("vite");

// Render the production TSX components with the same transformer used by Vite.
// Only the browser configuration needs a window stub; React and utilities are real.
const sourceRoot = path.join(__dirname, "../src");
const component = Promise.all(
  [
    "shared/config.ts",
    "shared/utils.ts",
    "shared/components/Icon.tsx",
    "features/download-queue/DownloadCard.tsx",
  ].map(async (relative) => {
    const filename = path.join(sourceRoot, relative);
    const transformed = await transformWithOxc(
      fs.readFileSync(filename, "utf8"),
      filename,
      {
        jsx: { runtime: "automatic" },
      },
    );
    const exported = [
      ...transformed.code.matchAll(/^export (?:const|function|class) (\w+)/gm),
    ].map((match) => match[1]);
    const code = transformed.code
      .replace(
        /^import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?$/gm,
        (_, names, id) =>
          `const {${names.replace(/\s+as\s+/g, ": ")}} = require(${JSON.stringify(id)});`,
      )
      .replace(/^export /gm, "");
    return [filename, `${code}\nmodule.exports = { ${exported.join(", ")} };`];
  }),
).then((entries) => {
  const sources = new Map(entries);
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    vm.runInNewContext(
      sources.get(filename),
      {
        module,
        exports: module.exports,
        window: {},
        require(id) {
          if (!id.startsWith(".")) return require(id);
          const target = path.resolve(path.dirname(filename), id);
          const resolved = [target, `${target}.ts`, `${target}.tsx`].find(
            (item) => sources.has(item),
          );
          assert.ok(resolved, `Unexpected component dependency: ${id}`);
          return load(resolved);
        },
      },
      { filename },
    );
    return module.exports;
  }
  return load(path.join(sourceRoot, "features/download-queue/DownloadCard.tsx"))
    .DownloadCard;
});

const baseJob = {
  id: "progress-job",
  url: "https://example.com/video",
  title: "Progress test",
  thumbnail: null,
  type: "video",
  format: "mp4",
  quality: "720p",
  status: "downloading",
  progress: 0,
  downloadedBytes: 0,
  totalBytes: 100,
  speedBytes: null,
  etaSeconds: null,
  queuePosition: null,
  attempt: 1,
  error: null,
  filename: null,
  createdAt: 1,
  updatedAt: 1,
};
async function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(await component, {
      job: { ...baseJob, ...overrides },
      onCancel: async () => {},
      onRetry: async () => {},
      onSave: async () => {},
    }),
  );
}
function track(html) {
  const match = html.match(/<div\b[^>]*role="progressbar"[^>]*><div\b[^>]*>/);
  assert.ok(match, "An active job must expose its progress indicator");
  return match[0];
}

test("unknown download size shows an active indeterminate indicator with live byte statistics", async () => {
  for (const totalBytes of [null, 0]) {
    const html = await render({
      totalBytes,
      downloadedBytes: 2 * 1024 ** 2,
      speedBytes: 512 * 1024,
    });
    const indicator = track(html);
    assert.match(indicator, /\bindeterminate-track\b/);
    assert.match(indicator, /aria-valuetext="Downloading; total size unknown"/);
    assert.doesNotMatch(indicator, /aria-valuenow=/);
    assert.doesNotMatch(html, /class="progress-percent"/);
    assert.doesNotMatch(indicator, /style="width:0%"/);
    assert.match(html, /2\.0 MB/);
    assert.match(html, /512\.0 KB\/s/);
    assert.match(html, /Calculating time…/);
  }
});

test("known download size advances the visible bar and accessible value together", async () => {
  for (const progress of [0, 42.4, 87]) {
    const html = await render({
      progress,
      downloadedBytes: progress,
      totalBytes: 100,
      etaSeconds: 12,
    });
    assert.match(
      track(html),
      new RegExp(`aria-valuenow="${Math.round(progress)}"`),
    );
    assert.match(
      track(html),
      new RegExp(`style="width:100%;transform:scaleX\\(${progress / 100}\\)"`),
    );
    assert.match(
      html,
      new RegExp(`class="progress-percent">${Math.round(progress)}%`),
    );
    assert.doesNotMatch(track(html), /indeterminate-track/);
    assert.match(html, /12 sec left/);
  }
});

test("a newly discovered size switches an active download from indeterminate to a measured bar", async () => {
  const unknown = await render({ downloadedBytes: 25, totalBytes: null });
  const measured = await render({
    downloadedBytes: 50,
    totalBytes: 100,
    progress: 50,
  });
  assert.doesNotMatch(track(unknown), /aria-valuenow=/);
  assert.match(track(measured), /aria-valuenow="50"/);
  assert.match(track(measured), /style="width:100%;transform:scaleX\(0\.5\)"/);
});

test("invalid percentages cannot produce non-finite or out-of-range progress widths", async () => {
  for (const [progress, expected] of [
    [-20, 0],
    [150, 100],
    [NaN, 0],
    [Infinity, 0],
    [-Infinity, 0],
  ]) {
    const html = await render({ progress });
    const indicator = track(html);
    assert.match(indicator, new RegExp(`aria-valuenow="${expected}"`));
    assert.match(
      indicator,
      new RegExp(`style="width:100%;transform:scaleX\\(${expected / 100}\\)"`),
    );
    assert.match(html, new RegExp(`class="progress-percent">${expected}%`));
    assert.doesNotMatch(indicator, /NaN|Infinity/);
  }
});

test("queued jobs show their queue position without download statistics or a fabricated percentage", async () => {
  const html = await render({
    status: "queued",
    totalBytes: null,
    queuePosition: 2,
  });
  assert.match(html, /Queued · 2 in line/);
  assert.match(html, /Your download will begin when a slot is available\./);
  assert.match(track(html), /aria-valuenow="0"/);
  assert.doesNotMatch(html, /progress-percent|job-stats|indeterminate-track/);
});

test("processing distinguishes finishing work from measured download progress", async () => {
  const html = await render({
    status: "processing",
    progress: 100,
    downloadedBytes: 100,
  });
  assert.match(html, /Finishing your file/);
  assert.match(track(html), /processing-track/);
  assert.match(track(html), /aria-valuetext="Processing downloaded media"/);
  assert.doesNotMatch(track(html), /aria-valuenow=/);
  assert.match(track(html), /style="width:100%"/);
  assert.doesNotMatch(html, /progress-percent|job-stats/);
  assert.doesNotMatch(html, /Download complete/);
});

test("processing stages stay visible and cancellable until final completion", async () => {
  for (const [stage, label] of [
    ["merging", "Merging audio and video"],
    ["converting_audio", "Converting audio"],
    ["processing_thumbnail", "Processing thumbnail"],
    ["embedding_thumbnail", "Embedding thumbnail"],
    ["finalizing", "Finalizing file"],
  ]) {
    const html = await render({ status: "processing", stage, progress: 99 });
    assert.match(html, new RegExp(label));
    assert.match(track(html), new RegExp(`aria-valuetext="${label}"`));
    assert.match(html, /aria-label="Cancel Progress test"/);
    assert.doesNotMatch(html, /Download complete|Ready to save|Save file/);
  }
});

test("nonfatal artwork warnings preserve completed media actions", async () => {
  const html = await render({
    status: "completed",
    thumbnailEmbedded: false,
    warnings: ["The thumbnail could not be embedded. Your original media is ready."],
  });
  assert.match(html, /class="job-warning" role="status"/);
  assert.match(html, /Your original media is ready/);
  assert.match(html, /Save file/);
  assert.doesNotMatch(html, /Download failed|class="job-error"|Cover artwork embedded/);
  const embedded = await render({ status: "completed", thumbnailEmbedded: true });
  assert.match(embedded, /Cover artwork embedded/);
});

test("optional thumbnail remains available after main media delivery and disappears after its own delivery", async () => {
  const sidecar = { status: "delivered", sidecarFilename: "Progress test.jpg" };
  assert.match(await render(sidecar), /Save thumbnail/);
  assert.doesNotMatch(await render(sidecar), />Save file</);
  assert.doesNotMatch(await render({ ...sidecar, sidecarDelivered: true }), /Save thumbnail/);
  const desktop = await render({ ...sidecar, sidecarSavedPath: "D:\\Downloads\\Progress test.jpg" });
  assert.doesNotMatch(desktop, /Save thumbnail/);
  assert.match(desktop, /Thumbnail: D:\\Downloads\\Progress test\.jpg/);
});

test("completed and terminal jobs do not leave an active progressbar visible", async () => {
  for (const status of ["completed", "delivered", "failed", "cancelled"]) {
    const html = await render({ status, progress: 100, downloadedBytes: 100 });
    assert.doesNotMatch(html, /role="progressbar"|progress-percent|job-stats/);
  }
});

// Drive the actual event handlers with deterministic hook state. This avoids a DOM
// dependency while allowing an HTTP snapshot to resolve after a newer SSE update.
const hookSource =
  stripTypeScriptTypes(
    fs
      .readFileSync(path.join(sourceRoot, "features/download-queue/useDownloads.ts"), "utf8")
      .replace(/^import .*$/gm, ""),
    { mode: "strip" },
  ).replace(/^export /gm, "") + "\nmodule.exports = { useDownloads };";
function downloadHook(jobs) {
  const slots = [];
  const pendingEffects = [];
  const sources = [];
  let cursor = 0;
  let dirty = true;
  let current;
  const module = { exports: {} };
  const sameDependencies = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  vm.runInNewContext(
    hookSource,
    {
      module,
      downloadsApi: { jobs, eventsUrl: () => "/api/events" },
      instagramApi: { queue: async () => ({ jobs: [], errors: [] }) },
      errorMessage: (reason) => String(reason),
      useState(initial) {
        const index = cursor++;
        if (!slots[index]) {
          const slot = {
            value: typeof initial === "function" ? initial() : initial,
          };
          slot.set = (next) => {
            const value = typeof next === "function" ? next(slot.value) : next;
            if (!Object.is(slot.value, value)) {
              slot.value = value;
              dirty = true;
            }
          };
          slots[index] = slot;
        }
        return [slots[index].value, slots[index].set];
      },
      useRef(initial) {
        const index = cursor++;
        if (!slots[index]) slots[index] = { value: { current: initial } };
        return slots[index].value;
      },
      useCallback(callback, dependencies) {
        const index = cursor++;
        if (
          !slots[index] ||
          !sameDependencies(slots[index].dependencies, dependencies)
        )
          slots[index] = { value: callback, dependencies };
        return slots[index].value;
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const slot = slots[index] || (slots[index] = {});
        if (!sameDependencies(slot.dependencies, dependencies)) {
          slot.dependencies = dependencies;
          pendingEffects.push(() => {
            slot.cleanup?.();
            slot.cleanup = effect();
          });
        }
      },
      EventSource: class {
        constructor() {
          sources.push(this);
        }
        close() {
          this.closed = true;
        }
      },
      document: {
        visibilityState: "visible",
        addEventListener() {},
        removeEventListener() {},
      },
    },
    { filename: path.join(sourceRoot, "features/download-queue/useDownloads.ts") },
  );
  function flush() {
    for (let iterations = 0; dirty; iterations++) {
      assert.ok(iterations < 20, "Hook updates must settle");
      dirty = false;
      cursor = 0;
      current = module.exports.useDownloads();
      pendingEffects.splice(0).forEach((effect) => effect());
    }
    return current;
  }
  flush();
  return {
    current: flush,
    sources,
    dispose() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

test("a delayed refresh cannot move newer streamed progress backwards", async (t) => {
  const initial = { ...baseJob, progress: 10, updatedAt: 10 };
  let requests = 0;
  let release;
  const hook = downloadHook(() =>
    ++requests === 1
      ? Promise.resolve([initial])
      : new Promise((resolve) => {
          release = resolve;
        }),
  );
  t.after(() => hook.dispose());
  await new Promise(setImmediate);
  assert.equal(hook.current().loading, false);
  assert.equal(hook.sources.length, 1);
  const refreshing = hook.current().refresh();
  hook.sources[0].onmessage({
    data: JSON.stringify({ ...initial, progress: 80, updatedAt: 80 }),
  });
  assert.equal(hook.current().jobs[0].progress, 80);
  release([{ ...initial, progress: 40, updatedAt: 40 }]);
  await refreshing;
  assert.equal(hook.current().jobs[0].progress, 80);
  assert.equal(hook.current().jobs[0].updatedAt, 80);
});

test("a delayed refresh cannot overwrite a newer retry attempt", async (t) => {
  const initial = {
    ...baseJob,
    status: "failed",
    progress: 75,
    attempt: 1,
    updatedAt: 10,
  };
  let requests = 0;
  let release;
  const hook = downloadHook(() =>
    ++requests === 1
      ? Promise.resolve([initial])
      : new Promise((resolve) => {
          release = resolve;
        }),
  );
  t.after(() => hook.dispose());
  await new Promise(setImmediate);
  assert.equal(hook.current().loading, false);
  const refreshing = hook.current().refresh();
  hook.sources[0].onmessage({
    data: JSON.stringify({
      ...initial,
      status: "downloading",
      progress: 5,
      attempt: 2,
      updatedAt: 20,
    }),
  });
  release([{ ...initial, updatedAt: 30 }]);
  await refreshing;
  assert.equal(hook.current().jobs[0].attempt, 2);
  assert.equal(hook.current().jobs[0].progress, 5);
  assert.equal(hook.current().jobs[0].status, "downloading");
});

test("authoritative snapshots remove absent jobs while retaining newer surviving job state", async (t) => {
  const initial = { ...baseJob, progress: 10, updatedAt: 10 };
  let requests = 0;
  const hook = downloadHook(() =>
    Promise.resolve(
      ++requests === 1 ? [initial, { ...initial, id: "expired-job" }] : [],
    ),
  );
  t.after(() => hook.dispose());
  await new Promise(setImmediate);
  assert.equal(hook.current().jobs.length, 2);
  hook.sources[0].onmessage({
    data: JSON.stringify({ ...initial, progress: 80, updatedAt: 80 }),
  });
  hook.sources[0].onmessage({
    data: JSON.stringify([{ ...initial, progress: 20, updatedAt: 20 }]),
  });
  assert.equal(hook.current().jobs.length, 1);
  assert.equal(hook.current().jobs[0].progress, 80);
  await hook.current().refresh();
  assert.equal(hook.current().jobs.length, 0);
});
