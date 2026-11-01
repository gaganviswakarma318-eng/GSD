const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../public/theme.js"),
  "utf8",
);

function applySavedTheme(saved, storageUnavailable = false) {
  const root = { dataset: {}, style: {} };
  const meta = {
    content: "",
    setAttribute: (name, value) => {
      if (name === "content") meta.content = value;
    },
  };
  const localStorage = {
    getItem: () => {
      if (storageUnavailable) throw new Error("Storage unavailable");
      return saved;
    },
  };
  vm.runInNewContext(source, {
    window: { localStorage },
    document: {
      documentElement: root,
      querySelector: () => meta,
    },
  });
  return { root, meta };
}

test("startup applies each supported saved appearance before render", () => {
  for (const [theme, color] of [
    ["light", "#f3f2ec"],
    ["dark", "#1d221e"],
    ["black", "#000000"],
  ]) {
    const { root, meta } = applySavedTheme(theme);
    assert.equal(root.dataset.theme, theme);
    assert.equal(root.style.colorScheme, theme === "light" ? "light" : "dark");
    assert.equal(meta.content, color);
  }
});

test("unknown, removed or unavailable saved preferences fall back to light", () => {
  for (const result of [
    applySavedTheme("unexpected"),
    applySavedTheme("dark-blue"),
    applySavedTheme(null, true),
  ]) {
    assert.equal(result.root.dataset.theme, "light");
    assert.equal(result.root.style.colorScheme, "light");
    assert.equal(result.meta.content, "#f3f2ec");
  }
});
