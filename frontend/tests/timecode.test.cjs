const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const source =
  stripTypeScriptTypes(
    fs.readFileSync(path.join(__dirname, "../src/utils.ts"), "utf8"),
    { mode: "strip" },
  ).replace(/^export /gm, "") +
  "\nmodule.exports = { formatTimecode, parseTimecode };";
const testModule = { exports: {} };
vm.runInNewContext(source, { module: testModule, exports: testModule.exports });
const { formatTimecode, parseTimecode } = testModule.exports;

test("timecodes round-trip minute and hour formats", () => {
  assert.equal(parseTimecode("02:05"), 125);
  assert.equal(parseTimecode("1:02:05"), 3725);
  assert.equal(formatTimecode(125), "02:05");
  assert.equal(formatTimecode(3725), "1:02:05");
});

test("timecodes reject malformed minute and second fields", () => {
  for (const value of ["", "2", "1:60", "1:02:60", "1:60:00", "1:2x"])
    assert.equal(parseTimecode(value), null, value);
});
