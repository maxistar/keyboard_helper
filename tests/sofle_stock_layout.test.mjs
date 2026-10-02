import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_LAYOUTS } from "../src/app_config.js";
import {
  effectiveLayerEntry,
  normalizeKeyEntry,
  normalizeLayerData,
} from "../src/layout_catalog.js";
import { normalizeHidDescriptor } from "../src/hid_descriptor.js";
import { validateLayoutDefinition } from "../src/layout_semantics.js";

// Baseline: zmkfirmware/zmk tag v0.3.0
// - app/dts/layouts/josefadamcik/sofle.dtsi (60 physical keys, rotations around rx/ry)
// - app/boards/shields/sofle/sofle.dtsi (60-entry default_transform)
// - app/boards/shields/sofle/sofle.keymap (default, lower, raise, adjust; adjust via conditional_layers;
//   encoder sensor-bindings &inc_dec_kp C_VOL_UP C_VOL_DN and PG_UP PG_DN are intentionally not modelled)
const layoutUrl = new URL("../src/layout_sofle.json", import.meta.url);
const definition = JSON.parse(await readFile(layoutUrl, "utf8"));
const disabled = { text: "", alt: "Disabled", code: "" };
const round = (value) => Math.round(value * 1000) / 1000;

test("bundled Sofle uses the stable ZMK stock identity and integration-neutral metadata", () => {
  assert.equal(definition.format, "keyboard-helper-layout");
  assert.equal(definition.version, 1);
  assert.equal(definition.name, "Sofle Stock (ZMK v0.3.0)");
  assert.deepEqual(definition.keySize, { w: 57, h: 45, gap: 10 });
  assert.equal(validateLayoutDefinition(definition).valid, true);
  for (const property of ["bleLayerSource", "inputSourceSync", "combos", "embeddedAssets"]) {
    assert.equal(Object.hasOwn(definition, property), false, property);
  }
  assert.doesNotMatch(JSON.stringify(definition), /sensor|encoder|inc_dec|OLED|Corney|assets\/images/i);
});

test("bundled Sofle preserves the ZMK physical layout in transform order", () => {
  const stagger = [0.37, 0.37, 0.12, 0, 0.12, 0.24];
  const mainRows = Array.from({ length: 3 }, (_, row) => [
    ...stagger.map((offset, col) => ({ row: row + offset, col })),
    ...[...stagger].reverse().map((offset, index) => ({ row: row + offset, col: 9 + index })),
  ]).flat();
  const fourthRow = [
    ...stagger.map((offset, col) => ({ row: 3 + offset, col })),
    { row: 2.74, col: 6 }, { row: 2.74, col: 8 },
    ...[...stagger].reverse().map((offset, index) => ({ row: 3 + offset, col: 9 + index })),
  ];
  const thumbs = [
    { row: 4.37, col: 1.75, cls: "action" },
    { row: 4.12, col: 2.75, cls: "action" },
    { row: 4.12, col: 3.75, cls: "action" },
    { row: 4.213, col: 4.785, angle: 12, cls: "action" },
    { row: 4.012, col: 5.855, h: 1.5, angle: 24, cls: "action" },
    { row: 4.012, col: 8.145, h: 1.5, angle: -24, cls: "action" },
    { row: 4.213, col: 9.215, angle: -12, cls: "action" },
    { row: 4.12, col: 10.25, cls: "action" },
    { row: 4.12, col: 11.25, cls: "action" },
    { row: 4.37, col: 12.25, cls: "action" },
  ];

  assert.equal(definition.keyPositions.length, 60);
  assert.deepEqual(
    definition.keyPositions.map((position) => ({ ...position, row: round(position.row), col: round(position.col) })),
    [...mainRows, ...fourthRow, ...thumbs].map((position) => ({
      ...position, row: round(position.row), col: round(position.col),
    })),
  );
  assert.equal(definition.keyPositions.some(({ w }) => w != null), false);
});

test("bundled Sofle geometry is mirrored around the split", () => {
  const mirrored = [[0, 11], [12, 23], [24, 35], [36, 49], [42, 43], [50, 59], [51, 58], [52, 57], [53, 56], [54, 55]];
  for (const [left, right] of mirrored) {
    const a = definition.keyPositions[left];
    const b = definition.keyPositions[right];
    assert.equal(round(a.col + (a.w ?? 1) + b.col), 15, `${left}/${right} col`);
    assert.equal(round(a.row), round(b.row), `${left}/${right} row`);
    assert.equal(a.h ?? 1, b.h ?? 1);
    assert.equal((a.angle ?? 0) + (b.angle ?? 0), 0);
  }
});

test("bundled Sofle exposes the four ZMK stock layers in firmware order", () => {
  const normalized = normalizeLayerData(definition.keyLayers);
  assert.deepEqual(normalized.layerKeys, ["default", "lower", "raise", "adjust"]);
  assert.deepEqual(normalized.names, ["Default", "Lower", "Raise", "Adjust"]);
  assert.deepEqual(normalized.layers.map((layer) => layer.length), [60, 60, 60, 60]);

  const base = definition.keyLayers.default;
  assert.deepEqual(base.slice(0, 12), [
    ["`", "BackQuote"], ["1", "Num1"], ["2", "Num2"], ["3", "Num3"], ["4", "Num4"], ["5", "Num5"],
    ["6", "Num6"], ["7", "Num7"], ["8", "Num8"], ["9", "Num9"], ["0", "Num0"], disabled,
  ]);
  assert.deepEqual(base[12], ["Esc", "Escape"]);
  assert.deepEqual(base[23], { text: "⌫", alt: "Backspace", code: "Backspace" });
  assert.deepEqual(base.slice(41, 45), [["b", "KeyB"], ["Mute", ""], disabled, ["n", "KeyN"]]);
  assert.deepEqual(base.slice(50), [
    ["GUI", "MetaLeft"], ["Alt", "AltLeft"], ["Ctrl", "ControlLeft"], ["Lower", ""],
    { text: "⏎", alt: "Enter", code: "Return" }, ["Space", "Space"], ["Raise", ""],
    ["Ctrl", "ControlRight"], ["Alt", "AltGr"], ["GUI", "MetaRight"],
  ]);

  const { lower, raise, adjust } = definition.keyLayers;
  assert.deepEqual(lower.slice(1, 12).map(([label]) => label), [
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11",
  ]);
  assert.deepEqual(lower[23], ["F12", "F12"]);
  assert.deepEqual(lower.slice(37, 42), [
    ["=", "Equal"], ["-", "Minus"], ["+", "Shift+Equal"], ["{", "Shift+LeftBracket"], ["}", "Shift+RightBracket"],
  ]);
  assert.deepEqual(lower.slice(44, 49), [
    ["[", "LeftBracket"], ["]", "RightBracket"], [";", "SemiColon"], [":", "Shift+SemiColon"], ["\\", "BackSlash"],
  ]);

  assert.deepEqual(raise.slice(0, 6).map(([label]) => label), ["BT CLR", "BT 1", "BT 2", "BT 3", "BT 4", "BT 5"]);
  assert.deepEqual(raise.slice(13, 16), [["Insert", "Insert"], ["Print Screen", "PrintScreen"], ["Menu", ""]]);
  assert.deepEqual(raise[22], ["0", "Num0"]);
  assert.deepEqual(raise.slice(30, 36), [
    ["Page Down", "PageDown"], ["Left", "LeftArrow"], ["Down", "DownArrow"], ["Right", "RightArrow"],
    { text: "⌦", alt: "Delete", code: "Delete" }, { text: "⌫", alt: "Backspace", code: "Backspace" },
  ]);
  assert.deepEqual(raise.slice(37, 41), [["Undo", ""], ["Cut", ""], ["Copy", ""], ["Paste", ""]]);

  assert.deepEqual(adjust.slice(12, 18).map(([label]) => label), [
    "Ext Power", "RGB Hue-", "RGB Hue+", "RGB Sat-", "RGB Sat+", "RGB Effect",
  ]);
  assert.deepEqual(adjust[42], ["RGB Toggle", ""]);
});

test("bundled Sofle adjust is fully explicit and exposes conditional-layer controls without fallback", () => {
  const { adjust } = definition.keyLayers;
  assert.equal(adjust.includes(null), false);
  assert.equal(adjust.filter((entry) => entry?.alt === "Disabled").length, 45);
  const normalized = normalizeLayerData(definition.keyLayers);
  assert.deepEqual(effectiveLayerEntry(normalized.layers, 3, 20), disabled);
  assert.deepEqual(effectiveLayerEntry(normalized.layers, 3, 55), disabled);
});

test("bundled Sofle maps ZMK behaviors without claiming unsupported HID evidence", () => {
  const normalized = normalizeLayerData(definition.keyLayers);

  assert.equal(definition.keyLayers.lower[0], null);
  assert.deepEqual(
    normalizeKeyEntry(effectiveLayerEntry(normalized.layers, 1, 0)),
    { label: "`", code: "BackQuote", explicit: true },
  );
  assert.equal(definition.keyLayers.raise[50], null);
  assert.deepEqual(effectiveLayerEntry(normalized.layers, 2, 50), ["GUI", "MetaLeft"]);

  const actionOnly = /^(Lower|Raise|Mute|Menu|Undo|Cut|Copy|Paste|BT |Ext Power|RGB )/;
  for (const layer of normalized.layers) {
    for (const entry of layer) {
      if (entry == null) continue;
      if (entry.alt === "Disabled") {
        assert.deepEqual(entry, disabled);
        continue;
      }
      const { label, code } = normalizeKeyEntry(entry);
      const text = typeof label === "object" ? label.text : label;
      if (actionOnly.test(text)) assert.equal(code, "", text);
      else assert.equal(normalizeHidDescriptor(code).supported, true, `${text} ${code}`);
    }
  }
});

test("bundled Sofle is registered immediately after Lily58 without reordering the catalog", () => {
  assert.deepEqual(BUILTIN_LAYOUTS.sofle, { name: "Sofle", file: "layout_sofle.json" });
  assert.deepEqual(Object.keys(BUILTIN_LAYOUTS), [
    "qwerty", "qwertz", "corne", "dactyl", "lily58", "sofle", "magic", "mac",
  ]);
});
