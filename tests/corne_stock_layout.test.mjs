import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  effectiveLayerEntry,
  normalizeKeyEntry,
  normalizeLayerData,
} from "../src/layout_catalog.js";
import { validateLayoutDefinition } from "../src/layout_semantics.js";

const layoutUrl = new URL("../src/layout_corne.json", import.meta.url);
const definition = JSON.parse(await readFile(layoutUrl, "utf8"));

test("bundled Corne uses the stable stock ZMK identity and integration-neutral metadata", () => {
  assert.equal(definition.format, "keyboard-helper-layout");
  assert.equal(definition.version, 1);
  assert.equal(definition.name, "Corne Stock (ZMK v0.3.0)");
  assert.equal(validateLayoutDefinition(definition).valid, true);

  for (const property of ["bleLayerSource", "inputSourceSync", "combos", "embeddedAssets"]) {
    assert.equal(Object.hasOwn(definition, property), false, property);
  }
  assert.doesNotMatch(JSON.stringify(definition), /Corney|Russian|Deutsch|asset:/i);
});

test("bundled Corne preserves official 42-key stagger and transform ordering", () => {
  assert.equal(definition.keyPositions.length, 42);
  assert.deepEqual(definition.keyPositions.slice(0, 12), [
    { row: 0.3, col: 0 }, { row: 0.3, col: 1 }, { row: 0.1, col: 2 },
    { row: 0, col: 3 }, { row: 0.1, col: 4 }, { row: 0.2, col: 5 },
    { row: 0.2, col: 9 }, { row: 0.1, col: 10 }, { row: 0, col: 11 },
    { row: 0.1, col: 12 }, { row: 0.3, col: 13 }, { row: 0.3, col: 14 },
  ]);
  assert.deepEqual(definition.keyPositions[35], { row: 2.3, col: 14 });
  assert.deepEqual(definition.keyPositions.slice(36), [
    { row: 3.7, col: 4, cls: "action" },
    { row: 3.7, col: 5, cls: "action" },
    { row: 3.2, col: 6, h: 1.5, cls: "action" },
    { row: 3.2, col: 8, h: 1.5, cls: "action" },
    { row: 3.7, col: 9, cls: "action" },
    { row: 3.7, col: 10, cls: "action" },
  ]);
});

test("bundled Corne exposes the three stock ZMK layers in firmware order", () => {
  const normalized = normalizeLayerData(definition.keyLayers);
  assert.deepEqual(normalized.layerKeys, ["default", "lower", "raise"]);
  assert.deepEqual(normalized.names, ["Default", "Lower", "Raise"]);
  assert.deepEqual(normalized.layers.map((layer) => layer.length), [42, 42, 42]);

  assert.deepEqual(definition.keyLayers.default.slice(36), [
    ["GUI", "MetaLeft"], ["Lower", ""], ["Space", "Space"],
    ["Enter", "Return"], ["Raise", ""], ["Alt", "AltGr"],
  ]);
  assert.deepEqual(definition.keyLayers.lower.slice(12, 22).map(normalizeKeyEntry), [
    { label: "BT CLR", code: "", explicit: true },
    { label: "BT 1", code: "", explicit: true },
    { label: "BT 2", code: "", explicit: true },
    { label: "BT 3", code: "", explicit: true },
    { label: "BT 4", code: "", explicit: true },
    { label: "BT 5", code: "", explicit: true },
    { label: "Left", code: "LeftArrow", explicit: true },
    { label: "Down", code: "DownArrow", explicit: true },
    { label: "Up", code: "UpArrow", explicit: true },
    { label: "Right", code: "RightArrow", explicit: true },
  ]);
  assert.deepEqual(definition.keyLayers.raise.slice(18, 24), [
    ["-", "Minus"], ["=", "Equal"], ["[", "LeftBracket"],
    ["]", "RightBracket"], ["\\", "BackSlash"], ["`", "BackQuote"],
  ]);

  assert.equal(definition.keyLayers.lower[25], null);
  assert.deepEqual(
    normalizeKeyEntry(effectiveLayerEntry(normalized.layers, 1, 25)),
    { label: "z", code: "KeyZ", explicit: true },
  );
  assert.equal(definition.keyLayers.raise[37], null);
  assert.deepEqual(
    normalizeKeyEntry(effectiveLayerEntry(normalized.layers, 2, 37)),
    { label: "Lower", code: "", explicit: true },
  );
});
