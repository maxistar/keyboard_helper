import assert from "node:assert/strict";
import test from "node:test";

import { createBleHighlightController } from "../src/ble_highlight.js";

function element(label) {
  const classes = new Set();
  return {
    textContent: label,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
}

function harness() {
  const keys = new Map([[17, element("G")]]);
  const combos = new Map([[9, false]]);
  const labels = [];
  const diagnostics = [];
  const controller = createBleHighlightController({
    resolvePosition: (position) => keys.get(position) ?? null,
    setComboActive: (id, active) => {
      if (!combos.has(id)) return false;
      combos.set(id, active);
      return true;
    },
    showPositionLabel: (target) => labels.push(target.textContent),
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { controller, keys, combos, labels, diagnostics };
}

test("BLE key events highlight by physical position and use the layout-owned label", () => {
  const env = harness();
  assert.equal(env.controller.handleEvent({ source: "ble", kind: "key", action: "down", position: 17, layer: 2 }), true);
  assert.equal(env.keys.get(17).classList.contains("pressed"), true);
  assert.deepEqual(env.labels, ["G"]);
  env.controller.handleEvent({ source: "ble", kind: "key", action: "up", position: 17, layer: 2 });
  assert.equal(env.keys.get(17).classList.contains("pressed"), false);
});

test("firmware-resolved combos activate by stable ID and clear as source-owned state", () => {
  const env = harness();
  env.controller.handleEvent({ source: "ble", kind: "combo", action: "down", comboId: 9, positions: [17, 18] });
  assert.equal(env.combos.get(9), true);
  env.controller.clear();
  assert.equal(env.combos.get(9), false);
});

test("unmatched BLE input reports diagnostics without highlighting another item", () => {
  const env = harness();
  assert.equal(env.controller.handleEvent({ source: "ble", kind: "key", action: "down", position: 99, layer: 0 }), false);
  assert.equal(env.controller.handleEvent({ source: "ble", kind: "combo", action: "down", comboId: 77, positions: [1, 2] }), false);
  assert.deepEqual(env.diagnostics.map(({ code }) => code), ["unmatched-position", "unmatched-combo"]);
  assert.equal(env.keys.get(17).classList.contains("pressed"), false);
});
