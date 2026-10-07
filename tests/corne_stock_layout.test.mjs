import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  effectiveLayerEntry,
  normalizeKeyEntry,
  normalizeLayerData,
} from "../src/layout_catalog.js";
import { validateLayoutDefinition } from "../src/layout_semantics.js";
import { calcCanvasGeometry } from "../src/layout_geometry.js";
import { MOBILE_BUNDLED_LAYOUT_DEFINITIONS } from "../src-mobile/bundled_layout_definitions.js";
import { createLayoutPresentation } from "../src-mobile/layout_viewer_model.js";

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
    { row: 3.2, col: 4, cls: "action" },
    { row: 3.2, col: 5, cls: "action", angle: 5 },
    { row: 2.9, col: 6, h: 1.5, cls: "action", angle: 10 },
    { row: 2.9, col: 8, h: 1.5, cls: "action", angle: -10 },
    { row: 3.2, col: 9, cls: "action", angle: -5 },
    { row: 3.2, col: 10, cls: "action" },
  ]);
});

function keyBottom(position, keySize) {
  const heightUnits = position.h ?? 1;
  return position.row * (keySize.h + keySize.gap)
    + keySize.h * heightUnits
    + keySize.gap * (heightUnits - 1);
}

test("bundled Corne thumb geometry matches the reviewed Corney physical cluster", () => {
  assert.equal(definition.keyPositions[36].row, 3.2);
  assert.equal(definition.keyPositions[37].row, 3.2);
  assert.equal(definition.keyPositions[38].row, 2.9);
  assert.equal(definition.keyPositions[39].row, 2.9);
  assert.equal(definition.keyPositions[40].row, 3.2);
  assert.equal(definition.keyPositions[41].row, 3.2);
  assert.equal(definition.keyPositions[38].h, 1.5);
  assert.equal(definition.keyPositions[39].h, 1.5);
  assert.equal(definition.keyPositions[38].col, 6);
  assert.equal(definition.keyPositions[39].col, 8);
  assert.deepEqual(definition.keyPositions.slice(37, 41).map(({ angle }) => angle), [5, 10, -10, -5]);

  assert.equal(keyBottom(definition.keyPositions[38], definition.keySize), 232);
  assert.equal(keyBottom(definition.keyPositions[39], definition.keySize), 232);
});

function assertKeysContained(definition, geometry) {
  const { keySize } = definition;
  for (const [index, position] of definition.keyPositions.entries()) {
    const widthUnits = position.w ?? 1;
    const heightUnits = position.h ?? 1;
    const left = position.col * (keySize.w + keySize.gap) - geometry.originX;
    const top = position.row * (keySize.h + keySize.gap) - geometry.originY;
    const width = keySize.w * widthUnits + keySize.gap * (widthUnits - 1);
    const height = keySize.h * heightUnits + keySize.gap * (heightUnits - 1);
    assert.ok(left >= -1e-6, `key ${index} is clipped on the left`);
    assert.ok(top >= -1e-6, `key ${index} is clipped on the top`);
    assert.ok(left + width <= geometry.width + 1e-6, `key ${index} is clipped on the right`);
    assert.ok(top + height <= geometry.height + 1e-6, `key ${index} is clipped on the bottom`);
  }
}

test("stock Corne inner thumbs fit the shared desktop and mobile canvases", () => {
  const desktopGeometry = calcCanvasGeometry(definition.keyPositions, definition.keySize);
  assertKeysContained(definition, desktopGeometry);

  const generated = MOBILE_BUNDLED_LAYOUT_DEFINITIONS.corne;
  const mobilePresentation = createLayoutPresentation(generated, 0);
  assert.equal(mobilePresentation.width, desktopGeometry.width);
  assert.equal(mobilePresentation.height, desktopGeometry.height);
  assert.deepEqual(mobilePresentation.origin, {
    x: desktopGeometry.originX,
    y: desktopGeometry.originY,
  });
  assertKeysContained(generated, {
    originX: mobilePresentation.origin.x,
    originY: mobilePresentation.origin.y,
    width: mobilePresentation.width,
    height: mobilePresentation.height,
  });
});

test("bundled Corne exposes the three stock ZMK layers in firmware order", () => {
  const normalized = normalizeLayerData(definition.keyLayers);
  assert.deepEqual(normalized.layerKeys, ["default", "lower", "raise"]);
  assert.deepEqual(normalized.names, ["Default", "Lower", "Raise"]);
  assert.deepEqual(normalized.layers.map((layer) => layer.length), [42, 42, 42]);

  assert.deepEqual(definition.keyLayers.default.slice(36), [
    ["GUI", "MetaLeft"], ["Lower", ""], ["Space", "Space"],
    { text: "⏎", alt: "Enter", code: "Return" }, ["Raise", ""], ["Alt", "AltGr"],
  ]);
  for (const layer of normalized.layers) {
    assert.deepEqual(normalizeKeyEntry(layer[11]), {
      label: { text: "⌫", alt: "Backspace" }, code: "Backspace", explicit: true,
    });
    assert.deepEqual(normalizeKeyEntry(layer[24]), {
      label: { text: "⇧", alt: "Shift" }, code: "ShiftLeft", explicit: true,
    });
    assert.equal(normalizeKeyEntry(layer[39]).code, "Return");
  }
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
