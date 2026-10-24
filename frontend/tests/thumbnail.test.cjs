const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transformWithOxc } = require("vite");

// Run the production composer with deterministic hooks so checkbox changes and
// the queued request are tested together without a browser or network fixture.
const sourceRoot = path.join(__dirname, "../src");
const sources = Promise.all([
  "utils.ts",
  "components/Icon.tsx",
  "components/DownloadComposer.tsx",
].map(async (relative) => {
  const filename = path.join(sourceRoot, relative);
  const transformed = await transformWithOxc(fs.readFileSync(filename, "utf8"), filename, {
    jsx: { runtime: "automatic" },
  });
  const exported = [...transformed.code.matchAll(/^export (?:const|function|class) (\w+)/gm)]
    .map((match) => match[1]);
  const code = transformed.code
    .replace(/^import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?$/gm,
      (_, names, id) => `const {${names.replace(/\s+as\s+/g, ": ")}} = require(${JSON.stringify(id)});`)
    .replace(/^export /gm, "");
  return [filename, `${code}\nmodule.exports = { ${exported.join(", ")} };`];
})).then((entries) => new Map(entries));

async function composer(format, { ffmpegAvailable = true, thumbnail = "https://example.com/cover.webp" } = {}) {
  const type = /^(mp3|m4a|flac|opus)$/.test(format) ? "audio" : "video";
  const supported = !["webm", "opus"].includes(format);
  const info = {
    url: "https://example.com/media",
    title: "Artwork fixture",
    thumbnail,
    options: [{
      id: `source-${format}`,
      type,
      format,
      quality: "Source quality",
      requiresConversion: false,
      thumbnailSupport: {
        supported,
        method: supported ? format === "mkv" ? "attachment" : "attached_pic" : null,
        reason: supported
          ? `${format.toUpperCase()} supports embedded artwork.${format === "mkv" ? " Player support for attachments is limited." : ""}`
          : `${format.toUpperCase()} does not support embedded artwork.`,
      },
    }],
  };
  const state = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial === "video" ? type : initial;
      return [state[index], (next) => {
        state[index] = typeof next === "function" ? next(state[index]) : next;
      }];
    },
    useEffect() {},
    useRef(initial) { return { current: initial }; },
  };
  const loaded = new Map();
  const source = await sources;
  function load(filename) {
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const module = { exports: {} };
    loaded.set(filename, module);
    vm.runInNewContext(source.get(filename), {
      module,
      window: {},
      require(id) {
        if (id === "react") return hooks;
        if (id.endsWith("/config")) return { isDesktop: false };
        if (id.endsWith("/hooks/useMediaInfo")) return {
          useMediaInfo: () => ({ info, loading: false, error: "", lookup() {}, clear() {} }),
        };
        if (id === "./MediaPreview") return { MediaPreview: () => null };
        if (!id.startsWith(".")) return require(id);
        const target = path.resolve(path.dirname(filename), id);
        const resolved = [`${target}.ts`, `${target}.tsx`].find((item) => source.has(item));
        assert.ok(resolved, `Unexpected composer dependency: ${id}`);
        return load(resolved);
      },
    }, { filename });
    return module.exports;
  }
  const Component = load(path.join(sourceRoot, "components/DownloadComposer.tsx")).DownloadComposer;
  const queued = [];
  const tree = () => {
    cursor = 0;
    return Component({
      unavailable: false,
      ffmpegAvailable,
      onQueue: async (...args) => { queued.push(args); return { id: "new-job" }; },
    });
  };
  function find(predicate, element = tree()) {
    if (!React.isValidElement(element)) return null;
    if (predicate(element)) return element;
    for (const child of React.Children.toArray(element.props.children)) {
      const found = find(predicate, child);
      if (found) return found;
    }
    return null;
  }
  const checkbox = (label) => find((element) =>
    element.type === "label" && React.Children.toArray(element.props.children)
      .some((child) => React.isValidElement(child) && child.props.children === label));
  const input = (label) => find((element) => element.type === "input", checkbox(label));
  return {
    html: () => renderToStaticMarkup(tree()),
    input,
    queued,
    async start() {
      const button = find((element) => element.type === "button" && element.props.className.includes("download-button"));
      button.props.onClick();
      await new Promise(setImmediate);
    },
  };
}

test("MP3, M4A and MP4 enable cover artwork by default and queue the preference", async () => {
  for (const format of ["mp3", "m4a", "mp4"]) {
    const view = await composer(format);
    assert.equal(view.input("Embed Thumbnail").props.checked, true);
    assert.equal(view.input("Embed Thumbnail").props.disabled, false);
    assert.match(view.html(), /Artwork visibility depends on your media player and device/);
    assert.doesNotMatch(view.html(), /Save thumbnail separately/);
    await view.start();
    assert.equal(view.queued[0][1], `source-${format}`);
    assert.deepEqual(JSON.parse(JSON.stringify(view.queued[0][3])), {
      embedThumbnail: true,
      thumbnailSidecar: false,
    });
  }
});

test("turning embedding off is reflected in the actual queue request", async () => {
  const view = await composer("mp4");
  view.input("Embed Thumbnail").props.onChange({ target: { checked: false } });
  assert.equal(view.input("Embed Thumbnail").props.checked, false);
  await view.start();
  assert.equal(view.queued[0][3].embedThumbnail, false);
});

test("WebM keeps its container and offers an optional, initially disabled thumbnail sidecar", async () => {
  const view = await composer("webm");
  assert.equal(view.input("Embed Thumbnail").props.checked, false);
  assert.equal(view.input("Embed Thumbnail").props.disabled, true);
  assert.equal(view.input("Save thumbnail separately").props.checked, false);
  assert.match(view.html(), /WEBM does not support embedded artwork/);
  view.input("Save thumbnail separately").props.onChange({ target: { checked: true } });
  await view.start();
  assert.equal(view.queued[0][1], "source-webm");
  assert.equal(view.queued[0][3].embedThumbnail, false);
  assert.equal(view.queued[0][3].thumbnailSidecar, true);
});

test("missing FFmpeg leaves source downloads available and explains artwork requirements", async () => {
  const view = await composer("mp4", { ffmpegAvailable: false });
  assert.equal(view.input("Embed Thumbnail").props.disabled, true);
  assert.match(view.html(), /FFmpeg is required to embed it/);
  await view.start();
  assert.equal(view.queued.length, 1);
  assert.equal(view.queued[0][3].embedThumbnail, false);
});

test("Matroska describes limited artwork player support and absent thumbnails are nonfatal", async () => {
  const matroska = await composer("mkv");
  assert.equal(matroska.input("Embed Thumbnail").props.checked, true);
  assert.match(matroska.html(), /Player support for attachments is limited/);
  const absent = await composer("m4a", { thumbnail: null });
  assert.match(absent.html(), /No thumbnail was found. Your media will still download normally/);
  await absent.start();
  assert.equal(absent.queued.length, 1);
});
