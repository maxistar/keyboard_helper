import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLayout,
  effectiveLayerEntry,
  loadLayoutCatalog,
  normalizeKeyEntry,
  normalizeLayerData,
} from "../src/layout_catalog.js";
import { calcBounds, calcKeyBounds } from "../src/keyboard_renderer.js";
import { descriptorMatches, normalizeHidDescriptor, normalizeModifier } from "../src/hid_descriptor.js";

test("normalizes named layers and keeps stable display order", () => {
  const base = [["A", "KeyA"]];
  const lower = [["1", "Digit1"]];
  assert.deepEqual(normalizeLayerData({ default: base, lower_layer: lower }), {
    layers: [base, lower],
    names: ["Default", "Lower layer"],
    layerKeys: ["default", "lower_layer"],
    layerMetadata: [
      { firmwareLayerIndex: null, selfTestExcludedPositions: [] },
      { firmwareLayerIndex: null, selfTestExcludedPositions: [] },
    ],
  });
});

test("normalizes explicit firmware layer metadata without inferring from order or labels", () => {
  const base = [["A", "KeyA"], ["Fn", ""]];
  const lower = [["1", "Digit1"], null];
  assert.deepEqual(normalizeLayerData(
    { Friendly_base: base, lower_layer: lower },
    {
      Friendly_base: { firmwareLayerIndex: 7, selfTestExcludedPositions: [1, 1, -1, 2, "0"] },
      lower_layer: { firmwareLayerIndex: 13, selfTestExcludedPositions: [0] },
    },
    2,
  ), {
    layers: [base, lower],
    names: ["Friendly base", "Lower layer"],
    layerKeys: ["Friendly_base", "lower_layer"],
    layerMetadata: [
      { firmwareLayerIndex: 7, selfTestExcludedPositions: [1] },
      { firmwareLayerIndex: 13, selfTestExcludedPositions: [0] },
    ],
  });
});

test("rejects malformed firmware indexes and exclusions instead of guessing", () => {
  const normalized = normalizeLayerData(
    { alpha: [["A", "KeyA"]], beta: [["B", "KeyB"]] },
    {
      alpha: { firmwareLayerIndex: "0", selfTestExcludedPositions: "all" },
      Renamed_Beta: { firmwareLayerIndex: 1, selfTestExcludedPositions: [0] },
    },
    1,
  );
  assert.deepEqual(normalized.layerKeys, ["alpha", "beta"]);
  assert.deepEqual(normalized.layerMetadata, [
    { firmwareLayerIndex: null, selfTestExcludedPositions: [] },
    { firmwareLayerIndex: null, selfTestExcludedPositions: [] },
  ]);
});

test("effective layer entries fall back only for absent or null entries", () => {
  const layers = [
    [["A", "KeyA"], ["B", "KeyB"]],
    [null, ["", ""]],
  ];
  assert.deepEqual(effectiveLayerEntry(layers, 1, 0), ["A", "KeyA"]);
  assert.deepEqual(effectiveLayerEntry(layers, 1, 1), ["", ""]);
  assert.equal(normalizeKeyEntry(effectiveLayerEntry(layers, 1, 1)).code, "");
});

test("shared geometry preserves spans and base labels", () => {
  const definition = {
    name: "Test",
    keySize: { w: 40, h: 42, gap: 4 },
    keyPositions: [{ row: 0, col: 0 }, { row: 1, col: 2, w: 2 }],
  };
  const layout = buildLayout(definition, [["A", "B"].map((label) => [label, `Key${label}`])]);
  assert.equal(layout.keys[0].code, "KeyA");
  assert.deepEqual(calcBounds(layout.keys), { maxCol: 4, maxRow: 2 });
  assert.deepEqual(calcKeyBounds(layout.keys[1], definition.keySize), {
    width: 84, height: 42, left: 88, top: 46,
  });
});

test("catalog loads built-in and external sources with isolated errors", async () => {
  const config = { defaultLayout: "qwerty", layouts: { qwerty: true, custom: "/tmp/custom.json" } };
  const definition = { name: "Loaded", keySize: { w: 1, h: 1 }, keyPositions: [{ row: 0, col: 0 }], keyLayers: [[[]]] };
  const catalog = await loadLayoutCatalog(config, {
    builtinFiles: { qwerty: "qwerty.json" },
    fetchJson: async () => definition,
    readExternal: async () => JSON.stringify({ ...definition, name: "Custom" }),
  });
  assert.deepEqual(Object.keys(catalog.definitions), ["qwerty", "custom"]);
  assert.equal(catalog.definitions.custom.name, "Custom");
  assert.deepEqual(catalog.errors, []);
});

test("HID descriptors normalize modifiers and require their active context", () => {
  const descriptor = normalizeHidDescriptor("Shift+KeyQ");
  assert.deepEqual(descriptor, {
    supported: true, raw: "Shift+KeyQ", trigger: "KeyQ", modifiers: ["Shift"],
  });
  assert.equal(descriptorMatches(descriptor, "KeyQ", ["Shift"]), true);
  assert.equal(descriptorMatches(descriptor, "KeyQ", []), false);
  assert.equal(normalizeModifier("ShiftLeft"), "Shift");
  assert.deepEqual(normalizeHidDescriptor("ShiftLeft"), {
    supported: true, raw: "ShiftLeft", trigger: "ShiftLeft", modifiers: [],
  });
  assert.equal(normalizeHidDescriptor("").supported, false);
  assert.equal(normalizeHidDescriptor("Foo+Bar").supported, false);
  assert.equal(normalizeHidDescriptor("MO(1)").supported, false);
  assert.equal(normalizeHidDescriptor("Unknown(115)").supported, false);
});
