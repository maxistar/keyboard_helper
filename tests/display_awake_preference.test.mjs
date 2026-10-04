import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDisplayAwakePreferenceView,
  DISPLAY_AWAKE_DEFAULT,
  DISPLAY_AWAKE_STORAGE_KEY,
  DisplayAwakePreference,
} from "../src-mobile/display_awake_preference.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

class ToggleStub {
  constructor() { this.checked = false; this.listeners = new Map(); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
  dispatch(type) { this.listeners.get(type)?.({ target: this }); }
}

test("display-awake preference defaults on and applies the native bridge", () => {
  const calls = [];
  const preference = new DisplayAwakePreference({
    storage: memoryStorage(),
    bridge: { setKeepScreenAwake: (enabled) => calls.push(enabled) },
  });
  assert.equal(preference.initialize(), DISPLAY_AWAKE_DEFAULT);
  assert.deepEqual(calls, [true]);
});

test("display-awake preference persists user choice and restores it on startup", () => {
  const storage = memoryStorage();
  const applied = [];
  const first = new DisplayAwakePreference({ storage, bridge: { setKeepScreenAwake: (enabled) => applied.push(enabled) } });
  first.initialize();
  first.setEnabled(false);
  assert.equal(storage.getItem(DISPLAY_AWAKE_STORAGE_KEY), "false");
  assert.deepEqual(applied, [true, false]);

  const second = new DisplayAwakePreference({ storage, bridge: { setKeepScreenAwake: (enabled) => applied.push(enabled) } });
  assert.equal(second.initialize(), false);
  assert.deepEqual(applied, [true, false, false]);
});

test("invalid and unavailable preference storage falls back to enabled without throwing", () => {
  const invalid = new DisplayAwakePreference({ storage: memoryStorage({ [DISPLAY_AWAKE_STORAGE_KEY]: "yes" }) });
  assert.equal(invalid.initialize(), true);
  assert.equal(invalid.setEnabled(false), false);

  const failing = new DisplayAwakePreference({
    storage: {
      getItem() { throw new Error("unavailable"); },
      setItem() { throw new Error("unavailable"); },
    },
    bridge: { setKeepScreenAwake() { throw new Error("bridge unavailable"); } },
  });
  assert.equal(failing.initialize(), true);
  assert.equal(failing.setEnabled(false), false);
  assert.equal(failing.snapshot(), false);

  const absent = new DisplayAwakePreference({ storage: null, bridge: null });
  assert.equal(absent.initialize(), true);
});

test("display-awake settings view synchronizes the accessible switch and disposes its listener", () => {
  const toggle = new ToggleStub();
  const document = { getElementById: (id) => id === "display-awake-toggle" ? toggle : null };
  const storage = memoryStorage();
  const applied = [];
  const view = createDisplayAwakePreferenceView(document, {
    storage,
    bridge: { setKeepScreenAwake: (enabled) => applied.push(enabled) },
  });
  assert.equal(toggle.checked, true);
  toggle.checked = false;
  toggle.dispatch("change");
  assert.equal(storage.getItem(DISPLAY_AWAKE_STORAGE_KEY), "false");
  assert.deepEqual(applied, [true, false]);
  view.dispose();
  assert.equal(toggle.listeners.has("change"), false);
});

test("mobile markup labels and explains the foreground-only display preference", async () => {
  const html = await readFile(path.join(root, "src-mobile/index.html"), "utf8");
  assert.match(html, /workspace-section-display[^>]*role="tab"[^>]*aria-controls="workspace-panel-display"/);
  assert.match(html, /id="display-awake-toggle" type="checkbox" role="switch" aria-describedby="display-awake-description"/);
  assert.match(html, /for="display-awake-toggle"[\s\S]*?Keep screen awake/);
  assert.match(html, /id="display-awake-description"[^>]*>[\s\S]*?only while the companion is open in the foreground/);
});
