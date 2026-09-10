import assert from "node:assert/strict";
import test from "node:test";

import {
  detectRuntimePlatform,
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
