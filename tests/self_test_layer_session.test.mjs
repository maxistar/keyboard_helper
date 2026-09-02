import assert from "node:assert/strict";
import test from "node:test";

import { createSelfTestLayerSession } from "../src/self_test/layer_session.js";

function harness() {
  const emitted = [];
  const started = [];
  const paused = [];
  let resumed = 0;
  const states = [];
  const session = createSelfTestLayerSession({
    emit: async (event, payload) => { emitted.push({ event, payload }); },
    startPlan: (plan) => { started.push(plan); return true; },
    pauseTest: (reason) => { paused.push(reason); return true; },
    resumeTest: () => { resumed += 1; return true; },
    onState: (state) => states.push(state),
  });
  return { session, emitted, started, paused, states, resumed: () => resumed };
}

function plan(overrides = {}) {
  return {
    layoutKey: "corney",
    layerKey: "Mac: Shift",
    firmwareLayerIndex: 5,
    testableIndexes: [0],
    ...overrides,
  };
}

test("mapped plan waits for authoritative lease confirmation before starting", async () => {
  const subject = harness();
  const generation = await subject.session.start(plan());
  assert.deepEqual(subject.started, []);
  assert.equal(subject.states.at(-1).mode, "activating");
  assert.deepEqual(subject.emitted.at(-1), {
    event: "self-test-layer-lease-request",
    payload: {
      generation,
      layoutKey: "corney",
      layerKey: "Mac: Shift",
      firmwareLayerIndex: 5,
    },
  });
  subject.session.handleLeaseStatus({ generation, state: "active" });
  assert.equal(subject.started.length, 1);
  assert.equal(subject.states.at(-1).mode, "active");
});

test("manual plans and unavailable layer control preserve manual HID testing", async () => {
  const unmapped = harness();
  await unmapped.session.start(plan({ firmwareLayerIndex: null }));
  assert.equal(unmapped.started.length, 1);
  assert.deepEqual(unmapped.emitted, []);
  assert.equal(unmapped.states.at(-1).mode, "manual");

  const unavailable = harness();
  const generation = await unavailable.session.start(plan());
  unavailable.session.handleLeaseStatus({ generation, state: "unavailable", message: "No writable BLE" });
  assert.equal(unavailable.started.length, 1);
  assert.equal(unavailable.states.at(-1).mode, "manual");
  assert.match(unavailable.states.at(-1).message, /No writable BLE/);
});

test("global combo plan starts without a layer lease or manual-layer warning", async () => {
  const subject = harness();
  await subject.session.start(plan({
    planKind: "global-combos",
    layerKey: null,
    firmwareLayerIndex: null,
  }));
  assert.equal(subject.started.length, 1);
  assert.deepEqual(subject.emitted, []);
  assert.equal(subject.states.at(-1).mode, "not-required");
  assert.match(subject.states.at(-1).message, /does not change the active layer/i);
});

test("stale confirmations cannot start or alter a newer plan", async () => {
  const subject = harness();
  const first = await subject.session.start(plan());
  const second = await subject.session.start(plan({ layerKey: "Mac: AltGr", firmwareLayerIndex: 6 }));
  subject.session.handleLeaseStatus({ generation: first, state: "active" });
  assert.deepEqual(subject.started, []);
  subject.session.handleLeaseStatus({ generation: second, state: "active" });
  assert.equal(subject.started[0].layerKey, "Mac: AltGr");
});

test("layer loss pauses and reasserts only after a clean input boundary", async () => {
  const subject = harness();
  const generation = await subject.session.start(plan());
  subject.session.handleLeaseStatus({ generation, state: "active" });
  subject.session.handleLeaseStatus({ generation, state: "lost", message: "Layer changed" });
  assert.deepEqual(subject.paused, ["Layer changed"]);
  subject.session.handleControllerSnapshot({ pressedCodes: ["ShiftLeft"], pressedPositions: [] });
  assert.equal(subject.emitted.filter((item) => item.event === "self-test-layer-lease-reassert").length, 0);
  subject.session.handleControllerSnapshot({ pressedCodes: [], pressedPositions: [] });
  assert.deepEqual(subject.emitted.at(-1), {
    event: "self-test-layer-lease-reassert",
    payload: { generation },
  });
  subject.session.handleLeaseStatus({ generation, state: "active" });
  assert.equal(subject.resumed(), 1);
});

test("release and manual continuation carry the owning generation", async () => {
  const subject = harness();
  const generation = await subject.session.start(plan());
  subject.session.handleLeaseStatus({ generation, state: "active" });
  await subject.session.continueManually();
  assert.deepEqual(subject.emitted.at(-1), {
    event: "self-test-layer-lease-manual",
    payload: { generation },
  });
  await subject.session.release();
  assert.deepEqual(subject.emitted.at(-1), {
    event: "self-test-layer-lease-release",
    payload: { generation },
  });
});
