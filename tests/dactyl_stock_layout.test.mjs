import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  effectiveLayerEntry,
  normalizeKeyEntry,
  normalizeLayerData,
} from "../src/layout_catalog.js";
import { validateLayoutDefinition } from "../src/layout_semantics.js";

const layoutUrl = new URL("../src/layout_dactyl.json", import.meta.url);
const definition = JSON.parse(await readFile(layoutUrl, "utf8"));

test("bundled Dactyl uses the stable QMK stock identity and integration-neutral metadata", () => {
  assert.equal(definition.format, "keyboard-helper-layout");
  assert.equal(definition.version, 1);
  assert.equal(definition.name, "Dactyl Manuform 5x6_5 Stock (QMK 0.33.0)");
  assert.equal(validateLayoutDefinition(definition).valid, true);

  for (const property of ["bleLayerSource", "inputSourceSync", "combos", "embeddedAssets"]) {
    assert.equal(Object.hasOwn(definition, property), false, property);
  }
  assert.doesNotMatch(
    JSON.stringify(definition),
    /BTCLR|BT[1-5]|Deutsch|German|Corney|apple_rainbow|android-logo|linux-logo|assets\/images/i,
  );
});

test("bundled Dactyl preserves QMK LAYOUT_5x6_5 geometry and ordering", () => {
  const mainRows = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 6 }, (_, col) => ({ row, col })),
    ...Array.from({ length: 6 }, (_, index) => ({ row, col: index + 11 })),
  ]).flat();
  const lowerAndThumbs = [
    { row: 4, col: 2 }, { row: 4, col: 3 },
    { row: 4, col: 5 }, { row: 4, col: 6 }, { row: 4, col: 7 },
    { row: 4, col: 9 }, { row: 4, col: 10 }, { row: 4, col: 11 },
    { row: 4, col: 13 }, { row: 4, col: 14 },
    { row: 5, col: 6 }, { row: 5, col: 7 },
    { row: 5, col: 9 }, { row: 5, col: 10 },
  ];

  assert.equal(definition.keyPositions.length, 62);
  assert.deepEqual(definition.keyPositions, [...mainRows, ...lowerAndThumbs]);
  assert.equal(definition.keyPositions.some(({ w, h, angle }) => w != null || h != null || angle != null), false);
});

test("bundled Dactyl exposes all seven QMK default layers in firmware order", () => {
  const normalized = normalizeLayerData(definition.keyLayers);
  assert.deepEqual(normalized.layerKeys, [
    "qwerty", "colemak", "numeric", "function", "navigation", "media", "mouse",
  ]);
  assert.deepEqual(normalized.names, [
    "Qwerty", "Colemak", "Numeric", "Function", "Navigation", "Media", "Mouse",
  ]);
  assert.deepEqual(normalized.layers.map((layer) => layer.length), Array(7).fill(62));

  assert.deepEqual(definition.keyLayers.qwerty.slice(0, 12), [
    ["`", "BackQuote"], ["1", "Num1"], ["2", "Num2"], ["3", "Num3"],
    ["4", "Num4"], ["5", "Num5"], ["6", "Num6"], ["7", "Num7"],
    ["8", "Num8"], ["9", "Num9"], ["0", "Num0"], ["-", "Minus"],
  ]);
  assert.deepEqual(
    definition.keyLayers.colemak.slice(13, 23).map(([label]) => label),
    ["q", "w", "f", "p", "g", "j", "l", "u", "y", ";"],
  );
  assert.deepEqual(definition.keyLayers.numeric[0], ["Boot", ""]);
  assert.deepEqual(definition.keyLayers.function[1], ["F1", "F1"]);
  assert.deepEqual(definition.keyLayers.navigation[30], ["Left", "LeftArrow"]);
  assert.deepEqual(definition.keyLayers.media[26], ["Previous", ""]);
  assert.deepEqual(definition.keyLayers.mouse[30], ["Mouse Left", ""]);

  assert.deepEqual(definition.keyLayers.qwerty[58], ["[ / Ctrl", "LeftBracket"]);
  assert.deepEqual(definition.keyLayers.qwerty[59], definition.keyLayers.qwerty[58]);
  assert.deepEqual(definition.keyLayers.numeric[18], ["7", "Num7"]);
  assert.deepEqual(definition.keyLayers.numeric[19], definition.keyLayers.numeric[18]);
});

test("bundled Dactyl maps QMK behaviors without claiming unsupported HID evidence", () => {
  const normalized = normalizeLayerData(definition.keyLayers);

  assert.equal(definition.keyLayers.numeric[14], null);
  assert.deepEqual(
    normalizeKeyEntry(effectiveLayerEntry(normalized.layers, 2, 14)),
    { label: "w", code: "KeyW", explicit: true },
  );

  assert.deepEqual(definition.keyLayers.numeric[27], { text: "", alt: "Disabled", code: "" });
  assert.deepEqual(
    normalizeKeyEntry(effectiveLayerEntry(normalized.layers, 2, 27)),
    { label: { text: "", alt: "Disabled" }, code: "", explicit: true },
  );
  const disabledCounts = normalized.layerKeys.map((layerKey) => definition.keyLayers[layerKey]
    .filter((entry) => entry?.alt === "Disabled").length);
  assert.deepEqual(disabledCounts, [0, 0, 5, 15, 15, 33, 27]);
  normalized.layers.forEach((layer, layerIndex) => {
    layer.forEach((entry, position) => {
      if (entry?.alt !== "Disabled") return;
      assert.deepEqual(entry, { text: "", alt: "Disabled", code: "" });
      assert.equal(effectiveLayerEntry(normalized.layers, layerIndex, position), entry);
    });
  });
  assert.equal(
    normalized.layers.flat().some((entry) => Array.isArray(entry) && entry[0] === "" && entry[1] === ""),
    false,
  );

  assert.deepEqual(definition.keyLayers.qwerty[24], ["Esc / Ctrl", "Escape"]);
  assert.deepEqual(definition.keyLayers.qwerty[51], ["Space / Mouse", "Space"]);
  assert.deepEqual(definition.keyLayers.qwerty[50], { text: "Num", alt: "Numeric", code: "" });
  assert.deepEqual(definition.keyLayers.qwerty[52], {
    text: "⌦ / Nav", alt: "Delete / Navigation", code: "Delete",
  });
  assert.deepEqual(definition.keyLayers.qwerty[53], {
    text: "⏎ / Nav", alt: "Enter / Navigation", code: "Return",
  });
  assert.deepEqual(definition.keyLayers.qwerty[55], {
    text: "⌫ / Num", alt: "Backspace / Numeric", code: "Backspace",
  });
  assert.deepEqual(definition.keyLayers.qwerty[36], { text: "( / ⇧", alt: "( / Shift", code: "" });
  assert.deepEqual(definition.keyLayers.navigation[22], { text: "⇧+Insert", alt: "Shift+Insert", code: "" });
  for (const layerKey of ["numeric", "function", "navigation", "media", "mouse"]) {
    assert.deepEqual(definition.keyLayers[layerKey][52], { text: "⌦", alt: "Delete", code: "Delete" });
    assert.deepEqual(definition.keyLayers[layerKey][55], { text: "⌫", alt: "Backspace", code: "Backspace" });
  }
  assert.deepEqual(definition.keyLayers.navigation[14], ["Ctrl+W", ""]);
  assert.deepEqual(definition.keyLayers.media[14], ["Play / Pause", ""]);
  assert.deepEqual(definition.keyLayers.mouse[18], ["Wheel Up", ""]);
});
