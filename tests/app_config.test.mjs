import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_LAYOUTS,
  configurationsEqual,
  createDefaultConfig,
  createExternalLayoutEntry,
  hotkeyFromKeyboardEvent,
  normalizeConfig,
  normalizeHotkey,
  parseExternalLayout,
  pickAvailableLayout,
  serializeConfig,
  validateConfigDraft,
} from "../src/app_config.js";

const validLayout = {
  name: "My Board",
  keySize: { w: 50, h: 50, gap: 4 },
  keyPositions: [{ row: 0, col: 0 }],
  keyLayers: { default: [["A", "KeyA"]] },
};

test("defaults enable every built-in layout and select QWERTY", () => {
  const config = createDefaultConfig();
  assert.equal(config.defaultLayout, "qwerty");
  assert.deepEqual(Object.keys(config.layouts), Object.keys(BUILTIN_LAYOUTS));
  assert.ok(Object.values(config.layouts).every((source) => source === true));
  assert.equal(config.toggleHotkey, null);
});

test("normalization keeps valid known and unknown data while repairing defaults", () => {
  const config = normalizeConfig({
    defaultLayout: "missing",
    toggleHotkey: "cmd+shift+k",
    layouts: { corne: true, bad: false, external: "/tmp/layout.json" },
    futureSetting: { enabled: true },
  });
  assert.equal(config.defaultLayout, "corne");
  assert.equal(config.toggleHotkey, "Shift+Meta+KeyK");
  assert.deepEqual(config.layouts, { corne: true, external: "/tmp/layout.json" });
  assert.deepEqual(config.futureSetting, { enabled: true });
});

test("serialization preserves unknown top-level fields", () => {
  const saved = serializeConfig(
    { futureSetting: 42, defaultLayout: "qwerty" },
    { defaultLayout: "corne", toggleHotkey: "Ctrl+KeyK", layouts: { corne: true } },
  );
  assert.deepEqual(saved, {
    futureSetting: 42,
    defaultLayout: "corne",
    toggleHotkey: "Ctrl+KeyK",
    layouts: { corne: true },
  });
});

test("draft validation enforces layout, default, and hotkey invariants", () => {
  assert.equal(validateConfigDraft({ layouts: {}, defaultLayout: "", toggleHotkey: "?" }).valid, false);
  assert.deepEqual(
    Object.keys(validateConfigDraft({ layouts: {}, defaultLayout: "", toggleHotkey: "?" }).errors).sort(),
    ["defaultLayout", "layouts", "toggleHotkey"],
  );
  assert.equal(validateConfigDraft({ layouts: { corne: true }, defaultLayout: "corne", toggleHotkey: null }).valid, true);
});

test("hotkeys normalize aliases and keyboard capture reports modifiers", () => {
  assert.equal(normalizeHotkey("option+command+7"), "Alt+Meta+Digit7");
  assert.equal(normalizeHotkey("Shift"), null);
  assert.deepEqual(hotkeyFromKeyboardEvent({ key: "Shift", code: "ShiftLeft" }), {
    value: null, pending: true, error: null,
  });
  assert.equal(
    hotkeyFromKeyboardEvent({ key: "k", code: "KeyK", shiftKey: true, metaKey: true }).value,
    "Shift+Meta+KeyK",
  );
});

test("external layouts are parsed, keyed uniquely, and deduplicated by path", () => {
  assert.equal(parseExternalLayout(JSON.stringify(validLayout)).valid, true);
  assert.match(parseExternalLayout("{").error, /valid JSON/);
  assert.match(parseExternalLayout(JSON.stringify({ name: "Broken" })).error, /key width/);

  const first = createExternalLayoutEntry({ path: "/tmp/board.json", definition: validLayout, layouts: {} });
  assert.equal(first.key, "my-board");
  const suffixed = createExternalLayoutEntry({
    path: "/tmp/second.json",
    definition: validLayout,
    layouts: { "my-board": "/tmp/first.json" },
  });
  assert.equal(suffixed.key, "my-board-2");
  const duplicate = createExternalLayoutEntry({
    path: "/tmp/board.json",
    definition: validLayout,
    layouts: { personal: "/tmp/board.json" },
  });
  assert.equal(duplicate.duplicateKey, "personal");
});

test("configuration comparison ignores object key order", () => {
  assert.equal(configurationsEqual({ layouts: { a: true, b: true } }, { layouts: { b: true, a: true } }), true);
});

test("available layout selection honors a changed startup and safely replaces removed layouts", () => {
  assert.equal(pickAvailableLayout({ defaultLayout: "corne" }, ["qwerty", "corne"], "qwerty"), "corne");
  assert.equal(pickAvailableLayout({ defaultLayout: "missing" }, ["qwerty", "corne"], "removed"), "qwerty");
  assert.equal(pickAvailableLayout({ defaultLayout: "external" }, ["corne"], "external"), "corne");
});
