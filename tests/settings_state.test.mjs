import assert from "node:assert/strict";
import test from "node:test";

import { createSettingsState } from "../src/settings_state.js";

const definition = {
  name: "Travel Board",
  keySize: { w: 50, h: 50, gap: 4 },
  keyPositions: [{ row: 0, col: 0 }],
  keyLayers: { default: [["A", "KeyA"]] },
};

test("missing configuration starts with a clean built-in draft", () => {
  const state = createSettingsState({ status: "missing", path: "/home/me/.keyri.json", revision: "missing" });
  const snapshot = state.snapshot();
  assert.equal(snapshot.draft.defaultLayout, "qwerty");
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.canSave, false);
});

test("valid edits remain draft-only and preserve unknown fields", () => {
  const state = createSettingsState({
    status: "valid",
    path: "/home/me/.keyri.json",
    sourcePath: "/home/me/.keyri.json",
    revision: "abc",
    data: { defaultLayout: "qwerty", layouts: { qwerty: true, corne: true }, future: 42 },
  });
  state.setDefaultLayout("corne");
  assert.equal(state.snapshot().dirty, true);
  assert.equal(state.snapshot().canSave, true);
  assert.equal(state.serializedConfig().future, 42);
  assert.equal(state.serializedConfig().defaultLayout, "corne");
});

test("disabled default and final layout block saving", () => {
  const state = createSettingsState({
    status: "valid", revision: "abc",
    data: { defaultLayout: "qwerty", layouts: { qwerty: true } },
  });
  state.setLayoutEnabled("qwerty", false);
  const snapshot = state.snapshot();
  assert.equal(snapshot.canSave, false);
  assert.ok(snapshot.validation.errors.layouts);
  assert.ok(snapshot.validation.errors.defaultLayout);
});

test("external layouts deduplicate paths and are removed only from the draft", () => {
  const state = createSettingsState({ status: "missing", revision: "missing" });
  const added = state.addExternal("/tmp/travel.json", definition);
  assert.equal(added.addedKey, "travel-board");
  assert.equal(state.snapshot().canSave, true);
  assert.equal(state.addExternal("/tmp/travel.json", definition).duplicateKey, "travel-board");
  state.removeLayout("travel-board");
  assert.equal(state.snapshot().draft.layouts["travel-board"], undefined);
});

test("existing external layout blocks save until metadata validation succeeds", () => {
  const state = createSettingsState({
    status: "valid", revision: "abc",
    data: { defaultLayout: "external", layouts: { external: "/tmp/layout.json" } },
  });
  state.setHotkey("Ctrl+KeyK");
  assert.equal(state.snapshot().canSave, false);
  state.setExternalMetadata("external", { name: "External", path: "/tmp/layout.json", valid: true });
  assert.equal(state.snapshot().canSave, true);
});

test("malformed configuration cannot save until replacement is explicit", () => {
  const state = createSettingsState({
    status: "invalid", path: "/home/me/.keyri.json", sourcePath: "/home/me/.keyri.json",
    revision: "broken", error: "invalid JSON",
  });
  state.setDefaultLayout("corne");
  assert.equal(state.snapshot().canSave, false);
  state.authorizeReplacement();
  assert.equal(state.snapshot().canSave, true);
  assert.equal(state.snapshot().replaceInvalid, true);
});
