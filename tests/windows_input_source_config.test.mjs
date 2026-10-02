import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { isValidWindowsInputSourceId, normalizeInputSourceSync } from "../src/input_source_sync_config.js";

const path = process.env.CORNEY_LAYOUT_PATH ?? new URL("../../corney/layout_corney.json", import.meta.url);
// The Corney layout lives in the sibling monorepo project and is absent from standalone checkouts.
const layout = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const count = layout ? Object.keys(layout.keyLayers).length : 0;
const skip = layout ? false : "requires the sibling corney/layout_corney.json";

test("actual Corney Windows fixture matches Linux layer families", { skip }, () => {
  const result = normalizeInputSourceSync(layout, count, { platform: "windows" });
  assert.equal(result.error, null);
  assert.equal(result.config.adapter, "windows");
  assert.equal(result.config.settleMs, 1000);
  assert.deepEqual(result.config.neutralLayers, [13, 14, 18]);
  for (const source of result.config.sources) {
    const linux = layout.inputSourceSync.linux.x11.sources.find(({ id }) => id === source.id);
    assert.equal(source.baseLayer, linux.baseLayer);
    assert.deepEqual(source.layers, linux.layers);
  }
  assert.deepEqual(result.config.sources.map(({ inputSourceId }) => inputSourceId), [
    "windows:klid:00000419", "windows:klid:00000407", "windows:klid:00000409",
  ]);
});

test("Windows IDs require a canonical nonzero KLID, preserving variants", { skip }, () => {
  for (const id of ["windows:klid:00000409", "windows:klid:00010409", "windows:klid:A0000409"]) {
    assert.equal(isValidWindowsInputSourceId(id), true);
  }
  for (const id of ["ru", "00000419", "windows:klid:00000000", "windows:klid:a0000409", "windows:klid:409"]) {
    const value = structuredClone(layout);
    value.inputSourceSync.windows.sources[0].inputSourceId = id;
    assert.equal(normalizeInputSourceSync(value, count, { platform: "windows" }).config, null);
    assert.equal(normalizeInputSourceSync(value, count, { platform: "linux" }).error, null);
    assert.equal(normalizeInputSourceSync(value, count, { platform: "macos" }).error, null);
  }
});

for (const [label, mutate] of [
  ["duplicate IDs", (c) => { c.sources[1].id = c.sources[0].id; }],
  ["duplicate KLIDs", (c) => { c.sources[1].inputSourceId = c.sources[0].inputSourceId; }],
  ["overlapping layers", (c) => { c.sources[1].layers.push(8); }],
  ["neutral overlap", (c) => { c.neutralLayers.push(8); }],
  ["invalid base", (c) => { c.sources[0].baseLayer = count; }],
  ["invalid delay", (c) => { c.settleMs = -1; }],
  ["empty label", (c) => { c.sources[0].label = ""; }],
]) {
  test(`Windows normalization rejects ${label}`, { skip }, () => {
    const value = structuredClone(layout);
    mutate(value.inputSourceSync.windows);
    assert.equal(normalizeInputSourceSync(value, count, { platform: "windows" }).config, null);
  });
}
