import test from "node:test";
import assert from "node:assert/strict";
import {
  createOverlayPresentationPayload,
  createSelfTestOverlayPresentation,
} from "../src/self_test/overlay_presentation.js";

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle: (name, force) => force ? values.add(name) : values.delete(name),
    contains: (name) => values.has(name),
  };
}

function harness() {
  const elements = [0, 1, 2].map((index) => ({ dataset: { index: String(index) }, classList: classList(index === 0 ? ["key", "pressed"] : ["key"]) }));
  const body = { classList: classList() };
  const root = { querySelectorAll: () => elements, ownerDocument: { body } };
  return { elements, body, presentation: createSelfTestOverlayPresentation({ root, body }) };
}

test("presentation payload maps results and the current physical position", () => {
  const payload = createOverlayPresentationPayload({
    phase: "waiting-down",
    plan: {
      layoutKey: "corne", layerIndex: 1,
      entries: [
        { index: 0, descriptor: { supported: true } },
        { index: 1, descriptor: { supported: true } },
        { index: 2, descriptor: { supported: false }, excludedFromRetest: false },
      ],
    },
    current: { index: 1 },
    results: { 0: { status: "passed" }, 2: { status: "not-testable" } },
  });
  assert.deepEqual(payload, {
    active: true, layoutKey: "corne", layerIndex: 1,
    states: { 0: "passed", 1: "expected", 2: "not-testable" },
  });
});

test("self-test outlines coexist with pressed state and clear independently", () => {
  const { elements, body, presentation } = harness();
  presentation.update({ active: true, states: { 0: "expected", 1: "passed", 2: "skipped" } });
  assert.equal(elements[0].classList.contains("pressed"), true);
  assert.equal(elements[0].classList.contains("self-test-expected"), true);
  assert.equal(elements[1].dataset.selfTestState, "passed");
  assert.equal(body.classList.contains("self-test-active"), true);

  presentation.clear();
  assert.equal(elements[0].classList.contains("pressed"), true);
  assert.equal(elements[0].classList.contains("self-test-expected"), false);
  assert.equal(body.classList.contains("self-test-active"), false);
});

test("refresh reapplies the retained snapshot after overlay keys rerender", () => {
  const { elements, presentation } = harness();
  presentation.update({ active: true, states: { 1: "unexpected" } });
  elements[1].classList.remove("self-test-unexpected");
  delete elements[1].dataset.selfTestState;
  presentation.refresh();
  assert.equal(elements[1].classList.contains("self-test-unexpected"), true);
});

test("setup snapshots clear the overlay presentation", () => {
  assert.deepEqual(createOverlayPresentationPayload({ phase: "setup", plan: null }), { active: false, states: {} });
});

test("release-drain snapshots keep results visible without arming a position", () => {
  const payload = createOverlayPresentationPayload({
    phase: "waiting-clean",
    plan: {
      layoutKey: "corne", layerIndex: 0,
      entries: [{ index: 0, descriptor: { supported: true } }],
    },
    current: { index: 0 },
    results: { 0: { status: "unexpected" } },
  });
  assert.deepEqual(payload.states, { 0: "unexpected" });
});
