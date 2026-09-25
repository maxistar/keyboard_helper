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

// Baseline: qmk/qmk_firmware tag 0.33.0
// - keyboards/lily58/rev1/keyboard.json (macro LAYOUT, 58 positions)
// - keyboards/lily58/keymaps/default/keymap.c (layers _QWERTY, _LOWER, _RAISE, _ADJUST;
//   update_tri_layer_state(_LOWER, _RAISE, _ADJUST))
const layoutUrl = new URL("../src/layout_lily58.json", import.meta.url);
const definition = JSON.parse(await readFile(layoutUrl, "utf8"));
const disabled = { text: "", alt: "Disabled", code: "" };

test("bundled Lily58 uses the stable QMK stock identity and integration-neutral metadata", () => {
  assert.equal(definition.format, "keyboard-helper-layout");
  assert.equal(definition.version, 1);
  assert.equal(definition.name, "Lily58 Stock (QMK 0.33.0)");
  assert.equal(validateLayoutDefinition(definition).valid, true);
  for (const property of ["bleLayerSource", "inputSourceSync", "combos", "embeddedAssets"]) {
    assert.equal(Object.hasOwn(definition, property), false, property);
  }
  assert.doesNotMatch(JSON.stringify(definition), /RGB|HUE|SAT|VAL|OLED|Corney|assets\/images/i);
});

test("bundled Lily58 preserves QMK lily58/rev1 LAYOUT geometry and ordering", () => {
  const stagger = [0.5, 0.375, 0.125, 0, 0.125, 0.25];
  const mainRows = Array.from({ length: 3 }, (_, row) => [
    ...stagger.map((offset, col) => ({ row: row + offset, col })),
    ...[...stagger].reverse().map((offset, index) => ({ row: row + offset, col: 10.5 + index })),
  ]).flat();
  const fourthRow = [
    ...stagger.map((offset, col) => ({ row: 3 + offset, col })),
    { row: 2.75, col: 6 }, { row: 2.75, col: 9.5 },
    ...[...stagger].reverse().map((offset, index) => ({ row: 3 + offset, col: 10.5 + index })),
  ];
  const thumbs = [
    { row: 4.125, col: 2.5, cls: "action" },
    { row: 4.15, col: 3.5, cls: "action" },
    { row: 4.25, col: 4.5, cls: "action" },
    { row: 4.25, col: 6, h: 1.5, cls: "action" },
    { row: 4.25, col: 9.5, h: 1.5, cls: "action" },
    { row: 4.25, col: 11, cls: "action" },
    { row: 4.15, col: 12, cls: "action" },
    { row: 4.15, col: 13, cls: "action" },
  ];

  assert.equal(definition.keyPositions.length, 58);
  assert.deepEqual(definition.keyPositions, [...mainRows, ...fourthRow, ...thumbs]);
  assert.equal(definition.keyPositions.some(({ w, angle }) => w != null || angle != null), false);
});

test("bundled Lily58 exposes the four QMK default layers in firmware order", () => {
  const normalized = normalizeLayerData(definition.keyLayers);
  assert.deepEqual(normalized.layerKeys, ["qwerty", "lower", "raise", "adjust"]);
  assert.deepEqual(normalized.names, ["Qwerty", "Lower", "Raise", "Adjust"]);
  assert.deepEqual(normalized.layers.map((layer) => layer.length), [58, 58, 58, 58]);

  assert.deepEqual(definition.keyLayers.qwerty.slice(0, 12), [
    ["Esc", "Escape"], ["1", "Num1"], ["2", "Num2"], ["3", "Num3"], ["4", "Num4"], ["5", "Num5"],
    ["6", "Num6"], ["7", "Num7"], ["8", "Num8"], ["9", "Num9"], ["0", "Num0"], ["`", "BackQuote"],
  ]);
  assert.deepEqual(definition.keyLayers.qwerty.slice(36, 50), [
    { text: "⇧", alt: "Shift", code: "ShiftLeft" },
    ["z", "KeyZ"], ["x", "KeyX"], ["c", "KeyC"], ["v", "KeyV"], ["b", "KeyB"],
    ["[", "LeftBracket"], ["]", "RightBracket"],
    ["n", "KeyN"], ["m", "KeyM"], [",", "Comma"], [".", "Dot"], ["/", "Slash"],
    { text: "⇧", alt: "Shift", code: "ShiftRight" },
  ]);
  assert.deepEqual(definition.keyLayers.qwerty.slice(50), [
    ["Alt", "AltLeft"], ["GUI", "MetaLeft"], ["Lower", ""], ["Space", "Space"],
    { text: "⏎", alt: "Enter", code: "Return" }, ["Raise", ""],
    { text: "⌫", alt: "Backspace", code: "Backspace" }, ["GUI", "MetaRight"],
  ]);

  assert.deepEqual(definition.keyLayers.lower.slice(12, 24).map(([label]) => label), [
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  ]);
  assert.deepEqual(definition.keyLayers.lower.slice(44, 50), [
    disabled, ["_", "Shift+Minus"], ["+", "Shift+Equal"],
    ["{", "Shift+LeftBracket"], ["}", "Shift+RightBracket"], ["|", "Shift+BackSlash"],
  ]);
  assert.deepEqual(definition.keyLayers.raise.slice(30, 36), [
    disabled, ["Left", "LeftArrow"], ["Down", "DownArrow"], ["Up", "UpArrow"],
    ["Right", "RightArrow"], disabled,
  ]);
  assert.deepEqual(definition.keyLayers.raise.slice(44, 50), [
    ["+", "Shift+Equal"], ["-", "Minus"], ["=", "Equal"],
    ["[", "LeftBracket"], ["]", "RightBracket"], ["\\", "BackSlash"],
  ]);
});

test("bundled Lily58 adjust follows pinned bindings rather than upstream RGB comments", () => {
  const { adjust } = definition.keyLayers;
  assert.deepEqual(adjust.slice(0, 50), Array(50).fill(disabled));
  assert.deepEqual(adjust.slice(50), Array(8).fill(null));

  const normalized = normalizeLayerData(definition.keyLayers);
  assert.deepEqual(
    normalizeKeyEntry(effectiveLayerEntry(normalized.layers, 3, 20)),
    { label: { text: "", alt: "Disabled" }, code: "", explicit: true },
  );
  assert.deepEqual(effectiveLayerEntry(normalized.layers, 3, 52), ["Lower", ""]);
});

test("bundled Lily58 maps QMK behaviors without claiming unsupported HID evidence", () => {
  const normalized = normalizeLayerData(definition.keyLayers);

  assert.equal(definition.keyLayers.lower[0], null);
  assert.deepEqual(
    normalizeKeyEntry(effectiveLayerEntry(normalized.layers, 1, 0)),
    { label: "Esc", code: "Escape", explicit: true },
  );
  assert.equal(definition.keyLayers.raise[23], null);
  assert.deepEqual(effectiveLayerEntry(normalized.layers, 2, 23), ["-", "Minus"]);

  for (const layer of normalized.layers) {
    for (const entry of layer) {
      if (entry?.alt === "Disabled") {
        assert.deepEqual(entry, disabled);
        continue;
      }
      if (entry == null) continue;
      const { label, code } = normalizeKeyEntry(entry);
      const text = typeof label === "object" ? label.text : label;
      if (text === "Lower" || text === "Raise") {
        assert.equal(code, "");
      } else {
        assert.equal(normalizeHidDescriptor(code).supported, true, `${text} ${code}`);
      }
    }
  }
});

test("bundled Lily58 is registered immediately after Dactyl without reordering the catalog", () => {
  assert.deepEqual(BUILTIN_LAYOUTS.lily58, { name: "Lily58", file: "layout_lily58.json" });
  assert.deepEqual(Object.keys(BUILTIN_LAYOUTS), ["qwerty", "qwertz", "corne", "dactyl", "lily58", "magic", "mac"]);
});
