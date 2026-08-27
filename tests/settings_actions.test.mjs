import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseExternalLayout,
  confirmSettingsClose,
  persistSettingsDraft,
} from "../src/settings_actions.js";
import { createSettingsState } from "../src/settings_state.js";

const validLayout = JSON.stringify({
  name: "Portable",
  keySize: { w: 40, h: 40 },
  keyPositions: [{ row: 0, col: 0 }],
  keyLayers: [[["A", "KeyA"]]],
});

test("file selection handles cancel, invalid, added, and duplicate outcomes", async () => {
  const state = createSettingsState({ status: "missing", revision: "missing" });
  assert.deepEqual(await chooseExternalLayout({ openFile: async () => null, readFile: async () => "", state }), {
    status: "cancelled",
  });
  const invalid = await chooseExternalLayout({
    openFile: async () => "/tmp/broken.json", readFile: async () => "{", state,
  });
  assert.equal(invalid.status, "invalid");
  const added = await chooseExternalLayout({
    openFile: async () => "/tmp/portable.json", readFile: async () => validLayout, state,
  });
  assert.equal(added.status, "added");
  const duplicate = await chooseExternalLayout({
    openFile: async () => "/tmp/portable.json", readFile: async () => validLayout, state,
  });
  assert.equal(duplicate.status, "duplicate");
});

test("dirty close asks for confirmation while a clean close does not", async () => {
  let confirmations = 0;
  assert.equal(await confirmSettingsClose(false, async () => { confirmations += 1; return false; }), true);
  assert.equal(confirmations, 0);
  assert.equal(await confirmSettingsClose(true, async () => { confirmations += 1; return false; }), false);
  assert.equal(confirmations, 1);
});

test("save sends revision-aware payload and propagates failures without committing", async () => {
  const state = createSettingsState({
    status: "valid", sourcePath: "/tmp/.keyri.json", revision: "rev-1",
    data: { defaultLayout: "qwerty", layouts: { qwerty: true } },
  });
  state.setHotkey("Ctrl+KeyK");
  let call;
  const result = await persistSettingsDraft({
    state,
    invoke: async (...args) => { call = args; return { revision: "rev-2" }; },
  });
  assert.equal(result.revision, "rev-2");
  assert.equal(call[0], "save_config");
  assert.equal(call[1].request.sourcePath, "/tmp/.keyri.json");
  assert.equal(call[1].request.config.toggleHotkey, "Ctrl+KeyK");

  await assert.rejects(
    persistSettingsDraft({ state, invoke: async () => { throw new Error("revision conflict"); } }),
    /revision conflict/,
  );
  assert.equal(state.snapshot().dirty, true);
});
