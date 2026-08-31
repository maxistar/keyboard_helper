import assert from "node:assert/strict";
import test from "node:test";

import { createInputSourceController } from "../src/input_source_controller.js";

const systemEvent = { kind: "key", source: "system", action: "down", code: "KeyA" };
const bleEvent = { kind: "key", source: "ble", action: "down", position: 0, layer: 0, sequence: 1, streamStart: false };

function createHarness(policy = "auto") {
  const events = [];
  const clears = [];
  const changes = [];
  const controller = createInputSourceController({
    policy,
    onEvent: (event) => events.push(event),
    onClearSourceState: (detail) => clears.push(detail),
    onEffectiveSourceChange: (detail) => changes.push(detail),
  });
  return { controller, events, clears, changes };
}

test("Auto remains on the system listener until a validated STREAM_START", () => {
  const harness = createHarness();
  assert.equal(harness.controller.handleEvent(systemEvent), true);
  harness.controller.setBleConnection({ capabilitiesValidated: true, subscribed: true });
  assert.equal(harness.controller.handleEvent(bleEvent), false);
  assert.equal(harness.controller.handleEvent({
    source: "ble", kind: "layer", layer: 0, previousLayer: 0,
    cause: 3, originPosition: 255, sequence: 1, streamStart: true,
  }), true);
  assert.equal(harness.controller.getSnapshot().effectiveSource, "ble");
  assert.equal(harness.controller.handleEvent(systemEvent), false);
  assert.deepEqual(harness.clears, [{ source: "system", reason: "ble-stream-start" }]);
});

test("forced BLE never silently falls back and disconnect clears BLE state", () => {
  const harness = createHarness("ble");
  assert.equal(harness.controller.getSnapshot().effectiveSource, null);
  assert.equal(harness.controller.handleEvent(systemEvent), false);
  harness.controller.setBleConnection({ capabilitiesValidated: true, subscribed: true });
  harness.controller.handleEvent({ ...bleEvent, streamStart: true });
  assert.equal(harness.controller.getSnapshot().effectiveSource, "ble");
  harness.controller.disconnectBle();
  assert.equal(harness.controller.getSnapshot().effectiveSource, null);
  assert.deepEqual(harness.clears.at(-1), { source: "ble", reason: "ble-disconnected" });
});

test("forced system listener ignores BLE while leaving BLE readiness intact", () => {
  const harness = createHarness("system");
  harness.controller.setBleConnection({ capabilitiesValidated: true, subscribed: true });
  assert.equal(harness.controller.handleEvent({ ...bleEvent, streamStart: true }), false);
  assert.equal(harness.controller.getSnapshot().bleReady, true);
  assert.equal(harness.controller.getSnapshot().effectiveSource, "system");
  assert.equal(harness.controller.handleEvent(systemEvent), true);
});

test("policy changes and sequence gaps clear source-owned transient state", () => {
  const harness = createHarness();
  harness.controller.setPolicy("system");
  assert.deepEqual(harness.clears.at(-1), { source: "system", reason: "policy-changed" });
  harness.controller.setPolicy("ble");
  harness.controller.setBleConnection({ capabilitiesValidated: true, subscribed: true });
  harness.controller.handleEvent({ ...bleEvent, streamStart: true });
  harness.controller.reportSequenceGap();
  assert.deepEqual(harness.clears.at(-1), { source: "ble", reason: "sequence-gap" });
});
