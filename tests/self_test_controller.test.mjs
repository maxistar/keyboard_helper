import test from "node:test";
import assert from "node:assert/strict";
import { buildComboTestPlan, buildTestPlan, createSelfTestController } from "../src/self_test/controller.js";

function fixture(layer = null) {
  const base = [["A", "KeyA"], ["A2", "KeyA"], ["Q", "Shift+KeyQ"], ["Layer", ""]];
  const layers = layer ? [base, layer] : [base];
  const definition = {
    name: "Fixture", keySize: { w: 40, h: 40, gap: 4 },
    keyPositions: base.map((_, col) => ({ row: 0, col })),
  };
  return buildTestPlan({ layoutKey: "fixture", definition, layers, layerNames: ["Base", "Fn"], layerIndex: layer ? 1 : 0 });
}

function oneKeyPlan(code, label = code) {
  return buildTestPlan({
    layoutKey: "one-key",
    definition: { name: "One key", keySize: { w: 40, h: 40, gap: 4 }, keyPositions: [{ row: 0, col: 0 }] },
    layers: [[[label, code]]],
    layerNames: ["Base"],
    layerIndex: 0,
  });
}

function onlyPosition(plan, index) {
  return Object.freeze({ ...plan, testableIndexes: Object.freeze([index]) });
}

test("plan freezes positions, repeats, null fallback, and unsupported entries", () => {
  const plan = fixture([null, ["B", "KeyB"], ["Macro", "A+B"], ["Empty", ""]]);
  assert.deepEqual(plan.testableIndexes, [0, 1]);
  assert.equal(plan.entries[0].rawCode, "KeyA");
  assert.equal(plan.entries[1].rawCode, "KeyB");
  assert.equal(plan.entries[2].testable, false);
  assert.equal(Object.isFrozen(plan.entries[0].position), true);
});

test("unmodified keys complete one full cycle and repeats do not advance", () => {
  const controller = createSelfTestController();
  controller.start(fixture());
  controller.handleKey("KeyA", "down");
  controller.handleKey("KeyA", "down");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  assert.deepEqual(controller.getSnapshot().pressedCodes, ["KeyA"]);
  controller.handleKey("KeyA", "up");
  assert.equal(controller.getSnapshot().current.index, 1);
  assert.equal(controller.getSnapshot().counts.passed, 1);
});

test("a single-modifier chord accepts modifier-first release and waits for the trigger", () => {
  const controller = createSelfTestController();
  controller.start(onlyPosition(fixture(), 2));
  controller.handleKey("ShiftLeft", "down");
  controller.handleKey("KeyQ", "down");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  assert.equal(controller.getSnapshot().chordActive, true);
  controller.handleKey("ShiftLeft", "up");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  assert.equal(controller.getSnapshot().counts.passed, 0);
  controller.handleKey("KeyQ", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
});

test("a single-modifier chord accepts trigger-first release and waits for the modifier", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("Shift+KeyQ"));
  controller.handleKey("ShiftRight", "down");
  controller.handleKey("KeyQ", "down");
  controller.handleKey("KeyQ", "up");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  assert.equal(controller.getSnapshot().counts.passed, 0);
  controller.handleKey("ShiftRight", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
});

test("a multi-modifier chord requires every contributor to be released", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("Control+Shift+KeyP"));
  controller.handleKey("ControlLeft", "down");
  controller.handleKey("ShiftRight", "down");
  controller.handleKey("KeyP", "down");
  controller.handleKey("KeyP", "up");
  controller.handleKey("ControlLeft", "up");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  controller.handleKey("ShiftRight", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
});

test("a physical modifier position can itself complete a guided cycle", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("ShiftLeft", "Shift"));
  controller.handleKey("ShiftLeft", "down");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  controller.handleKey("ShiftLeft", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
});

test("missing, extra, and duplicate logical modifiers are unexpected", () => {
  const missing = createSelfTestController();
  missing.start(oneKeyPlan("Shift+KeyQ"));
  missing.handleKey("KeyQ", "down");
  assert.equal(missing.getSnapshot().phase, "mismatch");

  const extra = createSelfTestController();
  extra.start(oneKeyPlan("Shift+KeyQ"));
  extra.handleKey("ShiftLeft", "down");
  extra.handleKey("ControlLeft", "down");
  assert.equal(extra.getSnapshot().phase, "mismatch");
  assert.equal(extra.getSnapshot().received, "ControlLeft");

  const duplicate = createSelfTestController();
  duplicate.start(oneKeyPlan("Shift+KeyQ"));
  duplicate.handleKey("ShiftLeft", "down");
  duplicate.handleKey("ShiftRight", "down");
  assert.equal(duplicate.getSnapshot().phase, "mismatch");
  assert.equal(duplicate.getSnapshot().received, "ShiftRight");
});

test("a stuck modifier keeps an accepted chord pending", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("Shift+KeyQ"));
  controller.handleKey("ShiftLeft", "down");
  controller.handleKey("KeyQ", "down");
  controller.handleKey("KeyQ", "up");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  assert.equal(controller.getSnapshot().counts.passed, 0);
});

test("unobserved releases do not change or complete the active step", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("KeyA"));
  controller.handleKey("KeyA", "up");
  controller.handleKey("ShiftLeft", "up");
  assert.equal(controller.getSnapshot().phase, "waiting-down");
  assert.deepEqual(controller.getSnapshot().pressedCodes, []);
});

test("Start waits for keys observed in setup to be released", () => {
  const controller = createSelfTestController();
  controller.handleKey("ShiftLeft", "down");
  controller.start(oneKeyPlan("KeyA"));
  assert.equal(controller.getSnapshot().phase, "waiting-clean");
  assert.equal(controller.getSnapshot().waitingForRelease, true);
  controller.handleKey("ShiftLeft", "up");
  assert.equal(controller.getSnapshot().phase, "waiting-down");
});

test("Retry drains the mismatched attempt before accepting another", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("KeyA"));
  controller.handleKey("KeyZ", "down");
  assert.equal(controller.getSnapshot().phase, "mismatch");
  assert.equal(controller.retry(), true);
  assert.equal(controller.getSnapshot().phase, "waiting-clean");
  controller.handleKey("KeyZ", "up");
  assert.equal(controller.getSnapshot().phase, "waiting-down");
  controller.handleKey("KeyA", "down");
  controller.handleKey("KeyA", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
});

test("Mark as problem drains input before arming the next position", () => {
  const controller = createSelfTestController();
  controller.start(fixture());
  controller.handleKey("KeyZ", "down");
  controller.markProblem();
  assert.equal(controller.getSnapshot().phase, "waiting-clean");
  assert.equal(controller.getSnapshot().results[0].received, "KeyZ");
  assert.equal(controller.getSnapshot().current.index, 0);
  controller.handleKey("KeyZ", "up");
  assert.equal(controller.getSnapshot().phase, "waiting-down");
  assert.equal(controller.getSnapshot().current.index, 1);
});

test("Skip during an active key waits for release before advancing", () => {
  const controller = createSelfTestController();
  controller.start(fixture());
  controller.handleKey("KeyA", "down");
  controller.skip();
  assert.equal(controller.getSnapshot().phase, "waiting-clean");
  assert.equal(controller.getSnapshot().results[0].status, "skipped");
  controller.handleKey("KeyA", "up");
  assert.equal(controller.getSnapshot().current.index, 1);
  assert.equal(controller.getSnapshot().phase, "waiting-down");
});

test("problem results can be retested after every attempt reaches a clean boundary", () => {
  const controller = createSelfTestController();
  controller.start(fixture());
  controller.skip();
  controller.handleKey("KeyZ", "down");
  controller.markProblem();
  controller.handleKey("KeyZ", "up");
  controller.handleKey("ShiftLeft", "down");
  controller.handleKey("KeyQ", "down");
  controller.handleKey("KeyQ", "up");
  controller.handleKey("ShiftLeft", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
  assert.deepEqual(controller.getSnapshot().counts, { passed: 1, unexpected: 1, skipped: 1, "not-testable": 1 });
  assert.equal(controller.retestProblems(), true);
  assert.deepEqual(controller.getSnapshot().plan.testableIndexes, [0, 1]);
});

test("empty plans do not start and stopping disposes session results", () => {
  const controller = createSelfTestController();
  const plan = fixture([["", ""], ["", ""], ["", ""], ["", ""]]);
  assert.equal(controller.start(plan), false);
  controller.start(fixture());
  controller.skip();
  controller.stop();
  assert.equal(controller.getSnapshot().phase, "setup");
  assert.deepEqual(controller.getSnapshot().results, {});
});

test("selected-layer plans keep unsupported ordinary positions untestable and never include global combos", () => {
  const definition = {
    name: "BLE fixture",
    keySize: { w: 40, h: 40, gap: 4 },
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    combos: [{ id: 9, positions: [0, 1], code: "Escape" }],
  };
  const plan = buildTestPlan({
    layoutKey: "ble-fixture",
    definition,
    layers: [[null, ["A", "KeyA"]]],
    layerNames: ["Base"],
    inputSource: "ble",
  });
  assert.deepEqual(plan.testableIndexes, [1]);
  assert.equal(plan.planKind, "layer");
  assert.equal(plan.entries[0].kind, "key");
  assert.equal(plan.entries[0].testable, false);
  assert.equal(plan.entries.some((entry) => entry.kind === "combo"), false);
});

test("global combo plans include only valid combos with non-empty trimmed codes", () => {
  const plan = buildComboTestPlan({
    layoutKey: "combo-fixture",
    definition: {
      name: "Combo fixture",
      keySize: { w: 40, h: 40, gap: 4 },
      keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
      combos: [
        { id: 9, positions: [0, 1], code: " Escape " },
        { id: 10, positions: [0, 1], code: "" },
        { id: 11, positions: [0, 1], code: "   " },
        { id: 12, positions: [0, 1] },
        { positions: [0, 7], code: "Invalid positions" },
      ],
    },
  });
  assert.equal(plan.planKind, "global-combos");
  assert.equal(plan.layerIndex, null);
  assert.equal(plan.firmwareLayerIndex, null);
  assert.deepEqual(plan.testableIndexes, [0]);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].rawCode, "Escape");
  assert.equal(plan.entries[0].comboId, 9);
});

test("selected-layer order becomes the firmware index and empty codes remain untestable", () => {
  const plan = buildTestPlan({
    layoutKey: "mapped",
    definition: {
      name: "Mapped",
      keySize: { w: 40, h: 40, gap: 4 },
      keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    },
    layers: [[["Shift", "ShiftLeft"], ["A", "KeyA"]], [["Layer", ""], ["B", "KeyB"]]],
    layerNames: ["Base", "Forced shift"],
    layerKeys: ["base", "forced_shift"],
    layerIndex: 1,
    inputSource: "ble",
  });
  assert.equal(plan.layerKey, "forced_shift");
  assert.equal(plan.firmwareLayerIndex, 1);
  assert.equal(plan.entries[0].rawCode, "");
  assert.equal(plan.entries[0].testable, false);
  assert.equal(plan.entries[1].testable, true);
});

test("BLE physical position alone cannot pass an ordinary key and wrong HID remains unexpected", () => {
  const matching = createSelfTestController();
  matching.start(onlyPosition(fixture(), 1));
  matching.handlePhysicalKey(1, "down");
  matching.handlePhysicalKey(1, "up");
  assert.equal(matching.getSnapshot().phase, "waiting-down");
  assert.equal(matching.getSnapshot().counts.passed, 0);
  matching.handleKey("KeyZ", "down");
  assert.equal(matching.getSnapshot().phase, "mismatch");
  assert.equal(matching.getSnapshot().received, "KeyZ");

  const wrong = createSelfTestController();
  wrong.start(onlyPosition(fixture(), 1));
  wrong.handlePhysicalKey(2, "down");
  assert.equal(wrong.getSnapshot().phase, "waiting-down");
  assert.equal(wrong.getSnapshot().diagnostics.at(-1).code, "unexpected-ble-key");
});

test("BLE combo events pass only matching metadata and retain unmatched diagnostics", () => {
  const definition = {
    name: "Combo fixture",
    keySize: { w: 40, h: 40, gap: 4 },
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    combos: [{ id: 9, positions: [0, 1], code: "Escape" }],
  };
  const plan = buildComboTestPlan({
    layoutKey: "combo-fixture",
    definition,
  });
  const controller = createSelfTestController();
  controller.start(plan);
  controller.handleCombo(77, [4, 5], "down");
  assert.equal(controller.getSnapshot().counts.passed, 0);
  assert.equal(controller.getSnapshot().diagnostics.at(-1).code, "unmatched-ble-combo");
  controller.handlePhysicalKey(0, "down");
  controller.handlePhysicalKey(1, "down");
  controller.handleCombo(9, [0, 1], "down");
  assert.equal(controller.getSnapshot().phase, "waiting-clean");
  controller.handlePhysicalKey(0, "up");
  controller.handlePhysicalKey(1, "up");
  assert.equal(controller.getSnapshot().phase, "complete");
  assert.equal(controller.getSnapshot().counts.passed, 1);
});

test("BLE fallback clears physical state, records the transition, and rearms the current step", () => {
  const controller = createSelfTestController();
  controller.start(onlyPosition(fixture(), 1));
  controller.handlePhysicalKey(1, "down");
  assert.deepEqual(controller.getSnapshot().pressedPositions, [1]);
  controller.handleSourceTransition("ble", "system", "ble-disconnected");
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.phase, "waiting-down");
  assert.deepEqual(snapshot.pressedPositions, []);
  assert.equal(snapshot.diagnostics.at(-1).code, "ble-fallback");
});

test("highlighting source transitions do not reset an in-progress system HID lifecycle", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("KeyA"));
  controller.handleKey("KeyA", "down");
  controller.handleSourceTransition("system", "ble", "telemetry-ready");
  assert.equal(controller.getSnapshot().phase, "chord-active");
  controller.handleKey("KeyA", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
  assert.equal(controller.getSnapshot().counts.passed, 1);
});

test("correct HID passes without BLE when telemetry is unavailable or privacy-disabled", () => {
  for (const inputSource of ["system", "ble"]) {
    const plan = Object.freeze({ ...oneKeyPlan("KeyA"), inputSource });
    const controller = createSelfTestController();
    controller.start(plan);
    controller.handleKey("KeyA", "down");
    controller.handleKey("KeyA", "up");
    const result = controller.getSnapshot().results[0];
    assert.equal(result.status, "passed");
    assert.equal(result.bleCorroborated, false);
  }
});

test("matching BLE lifecycle annotates but does not decide an ordinary HID pass", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("KeyA"));
  controller.handlePhysicalKey(0, "down");
  controller.handlePhysicalKey(0, "up");
  assert.equal(controller.getSnapshot().counts.passed, 0);
  controller.handleKey("KeyA", "down");
  controller.handleKey("KeyA", "up");
  assert.equal(controller.getSnapshot().results[0].bleCorroborated, true);
});

test("wrong or late BLE positions never block a correct HID verdict", () => {
  const wrong = createSelfTestController();
  wrong.start(oneKeyPlan("KeyA"));
  wrong.handlePhysicalKey(3, "down");
  wrong.handleKey("KeyA", "down");
  wrong.handleKey("KeyA", "up");
  assert.equal(wrong.getSnapshot().phase, "complete");
  assert.equal(wrong.getSnapshot().results[0].blePositionWarning, true);

  const late = createSelfTestController();
  late.start(oneKeyPlan("KeyA"));
  late.handleKey("KeyA", "down");
  late.handleKey("KeyA", "up");
  assert.equal(late.getSnapshot().phase, "complete");
  late.handlePhysicalKey(0, "down");
  late.handlePhysicalKey(0, "up");
  assert.equal(late.getSnapshot().results[0].status, "passed");
});

test("system HID events do not turn a firmware combo step into an ordinary mismatch", () => {
  const definition = {
    name: "Combo only",
    keySize: { w: 40, h: 40, gap: 4 },
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    combos: [{ id: 4, positions: [0, 1], code: "Escape" }],
  };
  const plan = buildComboTestPlan({
    layoutKey: "combo-only",
    definition,
  });
  const controller = createSelfTestController();
  controller.start(plan);
  controller.handleKey("Escape", "down");
  assert.equal(controller.getSnapshot().phase, "waiting-down");
  controller.handlePhysicalKey(0, "down");
  controller.handlePhysicalKey(1, "down");
  controller.handleCombo(4, [0, 1], "down");
  controller.handleKey("Escape", "up");
  controller.handlePhysicalKey(0, "up");
  controller.handlePhysicalKey(1, "up");
  assert.equal(controller.getSnapshot().phase, "complete");
});

test("layer pause ignores test evidence, drains held keys, and resumes the same step", () => {
  const controller = createSelfTestController();
  controller.start(oneKeyPlan("KeyA"));
  controller.handleKey("ShiftLeft", "down");
  assert.equal(controller.getSnapshot().phase, "mismatch");
  assert.equal(controller.pause("Layer changed"), true);
  controller.handleKey("KeyA", "down");
  controller.handleKey("KeyA", "up");
  assert.equal(controller.getSnapshot().counts.passed, 0);
  assert.equal(controller.resume(), true);
  assert.equal(controller.getSnapshot().phase, "waiting-clean");
  controller.handleKey("ShiftLeft", "up");
  assert.equal(controller.getSnapshot().phase, "waiting-down");
  controller.handleKey("KeyA", "down");
  controller.handleKey("KeyA", "up");
  assert.equal(controller.getSnapshot().phase, "complete");
});
