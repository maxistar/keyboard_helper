import test from "node:test";
import assert from "node:assert/strict";
import { buildTestPlan, createSelfTestController } from "../src/self_test/controller.js";

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
