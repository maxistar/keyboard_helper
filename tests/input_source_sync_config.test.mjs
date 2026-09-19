import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  detectRuntimePlatform,
  isValidXkbInputSourceId,
  normalizeInputSourceSync,
} from "../src/input_source_sync_config.js";
import { readJsonFixture } from "./fixture_helpers.mjs";

const validDefinition = readJsonFixture("layouts/corne-connected.json");

test("detectRuntimePlatform recognizes supported desktop families", () => {
  assert.equal(detectRuntimePlatform({ platform: "MacIntel" }), "macos");
  assert.equal(detectRuntimePlatform({ userAgentData: { platform: "Windows" } }), "windows");
  assert.equal(detectRuntimePlatform({ platform: "Linux x86_64" }), "linux");
});

test("normalizes valid macOS language families", () => {
  assert.deepEqual(normalizeInputSourceSync(validDefinition, 5, { platform: "macos" }), {
    config: {
      platform: "macos",
      adapter: "macos",
      ...validDefinition.inputSourceSync.macos,
      settleMs: 1000,
    },
    error: null,
  });
});

test("accepts an explicit settling interval", () => {
  const value = structuredClone(validDefinition);
  value.inputSourceSync.macos.settleMs = 200;
  assert.equal(
    normalizeInputSourceSync(value, 5, { platform: "macos" }).config.settleMs,
    200,
  );
});

test("omitted metadata is a normal opt-out", () => {
  assert.deepEqual(normalizeInputSourceSync({}, 5, { platform: "macos" }), {
    config: null,
    error: null,
  });
});

test("non-macOS runtimes ignore macOS metadata and validation", () => {
  const malformed = { inputSourceSync: { macos: { sources: "bad" } } };
  assert.deepEqual(normalizeInputSourceSync(malformed, 5, { platform: "linux" }), {
    config: null,
    error: null,
  });
});

test("ignores malformed non-current platform blocks", () => {
  const value = structuredClone(validDefinition);
  value.inputSourceSync.linux = { sources: "bad" };
  const result = normalizeInputSourceSync(value, 5, { platform: "macos" });
  assert.equal(result.error, null);
  assert.equal(result.config.platform, "macos");
});

test("normalizes nested Linux X11 metadata independently of adapter support", () => {
  const x11 = structuredClone(validDefinition.inputSourceSync.macos);
  x11.sources[0].inputSourceId = "xkb:layout:de";
  x11.sources[1].inputSourceId = "xkb:group:1";
  const value = { inputSourceSync: { linux: { x11 } } };
  const result = normalizeInputSourceSync(value, 5, { platform: "linux" });
  assert.equal(result.error, null);
  assert.equal(result.config.platform, "linux");
  assert.equal(result.config.adapter, "x11");
  assert.deepEqual(result.config.sources, x11.sources);
});

test("reports malformed current-platform metadata with platform-specific diagnostics", () => {
  const malformed = { inputSourceSync: { linux: { x11: { sources: "bad" } } } };
  const result = normalizeInputSourceSync(malformed, 5, { platform: "linux" });
  assert.equal(result.config, null);
  assert.match(result.error, /Invalid Linux input-source synchronization metadata/);
  assert.match(result.error, /linux\.x11\.sources/);
});

test("ignores non-X11 Linux adapter blocks and the former Linux leaf shape", () => {
  const future = { inputSourceSync: { linux: { wayland: { sources: "bad" } } } };
  assert.deepEqual(normalizeInputSourceSync(future, 5, { platform: "linux" }), {
    config: null,
    error: null,
  });

  const formerLeaf = { inputSourceSync: { linux: structuredClone(validDefinition.inputSourceSync.macos) } };
  assert.deepEqual(normalizeInputSourceSync(formerLeaf, 5, { platform: "linux" }), {
    config: null,
    error: null,
  });
});

test("validates canonical stable and fallback XKB identifiers", () => {
  for (const id of ["xkb:layout:de", "xkb:layout:us:dvorak", "xkb:group:0", "xkb:group:3"]) {
    assert.equal(isValidXkbInputSourceId(id), true, id);
  }
  for (const id of ["de", "xkb:layout:", "xkb:layout:us:", "xkb:group:-1", "xkb:group:4", "xkb:group:01"]) {
    assert.equal(isValidXkbInputSourceId(id), false, id);
  }
});

test("rejects malformed XKB identifiers without rejecting the layout", () => {
  const x11 = structuredClone(validDefinition.inputSourceSync.macos);
  x11.sources[0].inputSourceId = "de";
  x11.sources[1].inputSourceId = "xkb:layout:ru";
  const result = normalizeInputSourceSync({ inputSourceSync: { linux: { x11 } } }, 5, {
    platform: "linux",
  });
  assert.equal(result.config, null);
  assert.match(result.error, /must use xkb:layout/);
});

test("normalizes the external Corney X11 test layout", () => {
  const corney = JSON.parse(readFileSync(new URL("../../corney/layout_corney.json", import.meta.url), "utf8"));
  const layerCount = Object.keys(corney.keyLayers).length;
  const result = normalizeInputSourceSync(corney, layerCount, { platform: "linux" });
  assert.equal(result.error, null);
  assert.equal(result.config.adapter, "x11");
  assert.deepEqual(result.config.sources.map((source) => source.inputSourceId), [
    "xkb:layout:de",
    "xkb:layout:ru",
    "xkb:layout:us",
  ]);
  assert.deepEqual(
    result.config.sources.map(({ id, baseLayer, layers }) => ({ id, baseLayer, layers })),
    [
      { id: "de", baseLayer: 1, layers: [1, 2, 3, 15] },
      { id: "ru", baseLayer: 8, layers: [8, 11] },
      { id: "en", baseLayer: 0, layers: [0] },
    ],
  );
  assert.deepEqual(result.config.neutralLayers, [13, 14, 18]);
});

for (const [name, mutate, fragment] of [
  ["duplicate source IDs", (value) => { value.inputSourceSync.macos.sources[1].id = "de"; }, "duplicate source id"],
  ["duplicate input-source IDs", (value) => { value.inputSourceSync.macos.sources[1].inputSourceId = "com.apple.keylayout.German"; }, "duplicate inputSourceId"],
  ["overlapping families", (value) => { value.inputSourceSync.macos.sources[1].layers = [1, 2]; }, "more than one source family"],
  ["missing base family membership", (value) => { value.inputSourceSync.macos.sources[0].layers = [1]; }, "must contain its baseLayer"],
  ["invalid layer indexes", (value) => { value.inputSourceSync.macos.sources[0].layers = [0, 7]; }, "outside keyLayers"],
  ["family and neutral overlap", (value) => { value.inputSourceSync.macos.neutralLayers = [3]; }, "also belongs to a source family"],
  ["negative settling interval", (value) => { value.inputSourceSync.macos.settleMs = -1; }, "settleMs"],
  ["non-integer settling interval", (value) => { value.inputSourceSync.macos.settleMs = 1.5; }, "settleMs"],
  ["excessive settling interval", (value) => { value.inputSourceSync.macos.settleMs = 60_001; }, "settleMs"],
]) {
  test(`rejects ${name} without rejecting the layout`, () => {
    const value = structuredClone(validDefinition);
    mutate(value);
    const result = normalizeInputSourceSync(value, 5, { platform: "macos" });
    assert.equal(result.config, null);
    assert.match(result.error, new RegExp(fragment));
  });
}
