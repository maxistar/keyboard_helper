import assert from "node:assert/strict";
import test from "node:test";

import { BLE_KEYBOARD_FRAME_FLAGS, BLE_KEYBOARD_UUIDS } from "../src/ble_keyboard_decoder.js";
import { CapabilityMode, LifecyclePhase } from "../src-mobile/ble_lifecycle.js";
import {
  COMBO_VISUAL_EXPIRY_MS,
  createTelemetrySnapshot,
  MobileTelemetryController,
  TELEMETRY_DIAGNOSTIC_LIMIT,
  TelemetryStatus,
} from "../src-mobile/telemetry_session.js";
import { readJsonFixture } from "./fixture_helpers.mjs";

const fixture = readJsonFixture("ble/keyboard-events-v1.json");

function bytes(hex) {
  return Uint8Array.from(hex.match(/../gu) ?? [], (value) => Number.parseInt(value, 16));
}

function fixtureFrame(name, update = () => {}) {
  const frame = bytes(fixture.events.find((item) => item.name === name).hex);
  update(frame);
  return frame;
}

function setSequence(frame, sequence) {
  frame[4] = sequence & 0xff;
  frame[5] = (sequence >>> 8) & 0xff;
  frame[6] = (sequence >>> 16) & 0xff;
  frame[7] = (sequence >>> 24) & 0xff;
}

function fakeClock() {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    schedule(handler, delay) { const id = ++nextId; timers.set(id, { handler, delay }); return id; },
    cancel(id) { timers.delete(id); },
    fire(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].handler();
    },
  };
}

class FakeCoordinator {
  constructor({ capabilities = bytes(fixture.capabilities.hex), mode = CapabilityMode.ENHANCED, services = null } = {}) {
    this.state = { phase: LifecyclePhase.READY, generation: 1, capabilityMode: mode };
    this.capabilities = [...capabilities];
    this.services = services ?? [{
      uuid: BLE_KEYBOARD_UUIDS.service,
      characteristics: [{ uuid: BLE_KEYBOARD_UUIDS.events }],
    }];
    this.listeners = new Set();
    this.subscribeCalls = 0;
    this.subscriptionFailure = null;
  }

  snapshot() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  transition(state) { this.state = state; for (const listener of this.listeners) listener(state); }
  async subscribeNotifications(_service, _characteristic, handler) {
    this.subscribeCalls += 1;
    this.notificationHandler = handler;
    if (this.subscriptionFailure) throw this.subscriptionFailure;
    return { subscribed: true };
  }
  notify(frame) { this.notificationHandler?.({ bytes: [...frame] }); }
}

async function liveController(options = {}) {
  const coordinator = options.coordinator ?? new FakeCoordinator(options);
  const clock = options.clock ?? fakeClock();
  const controller = new MobileTelemetryController(coordinator, {
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  });
  await controller.whenSettled();
  coordinator.notify(fixtureFrame("stream-start-layer-snapshot"));
  assert.equal(controller.snapshot().status, TelemetryStatus.LIVE);
  return { clock, controller, coordinator };
}

test("telemetry snapshots expose every bounded immutable state without ownership restoration", () => {
  for (const status of Object.values(TelemetryStatus)) {
    const snapshot = createTelemetrySnapshot(2, status, { pressedPositions: [1], activeCombos: [{ comboId: 1, positions: [1, 2] }] });
    assert.equal(snapshot.status, status);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.pressedPositions), true);
    assert.equal(Object.isFrozen(snapshot.activeCombos[0].positions), true);
  }
});

test("stock, incomplete, malformed, unsupported, and empty capabilities never subscribe", async () => {
  const cases = [
    ["stock", new FakeCoordinator({ mode: CapabilityMode.STOCK }), "stock-keyboard"],
    ["missing event characteristic", new FakeCoordinator({ services: [{ uuid: BLE_KEYBOARD_UUIDS.service, characteristics: [] }] }), "event-characteristic-unavailable"],
    ["malformed", new FakeCoordinator({ capabilities: [1, 0] }), "invalid-capabilities-length"],
    ["unsupported", new FakeCoordinator({ capabilities: [2, 0, 7, 0, 20, 1, 0, 0] }), "unsupported-protocol-major"],
    ["no events", new FakeCoordinator({ capabilities: [1, 0, 0x60, 0, 20, 1, 0, 0] }), "event-kinds-unavailable"],
  ];
  for (const [name, coordinator, reason] of cases) {
    const controller = new MobileTelemetryController(coordinator);
    await controller.whenSettled();
    assert.equal(controller.snapshot().status, TelemetryStatus.UNAVAILABLE, name);
    assert.equal(controller.snapshot().reason.code, reason, name);
    assert.equal(coordinator.subscribeCalls, 0, name);
  }
});

test("subscription failure is bounded and does not replace connection readiness", async () => {
  const coordinator = new FakeCoordinator();
  coordinator.subscriptionFailure = new Error("private pairing detail");
  const controller = new MobileTelemetryController(coordinator);
  await controller.whenSettled();
  assert.equal(controller.snapshot().status, TelemetryStatus.FAILED);
  assert.equal(controller.snapshot().reason.code, "subscription-failed");
  assert.equal(JSON.stringify(controller.snapshot()).includes("private pairing detail"), false);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
});

test("state-bearing frames are ignored until an authoritative subscriber-local layer snapshot", async () => {
  const coordinator = new FakeCoordinator();
  const controller = new MobileTelemetryController(coordinator);
  await controller.whenSettled();
  assert.equal(controller.snapshot().status, TelemetryStatus.AWAITING_STREAM_START);
  coordinator.notify(fixtureFrame("key-down"));
  assert.deepEqual(controller.snapshot().pressedPositions, []);

  coordinator.notify(fixtureFrame("key-down", (frame) => { frame[2] = BLE_KEYBOARD_FRAME_FLAGS.streamStart; }));
  assert.equal(controller.snapshot().status, TelemetryStatus.AWAITING_STREAM_START);
  assert.equal(controller.snapshot().diagnostics.at(-1).code, "invalid-stream-start");

  coordinator.notify(fixtureFrame("stream-start-layer-snapshot"));
  assert.equal(controller.snapshot().status, TelemetryStatus.LIVE);
  assert.equal(controller.snapshot().activeLayer, 1);
  assert.equal(controller.snapshot().layerAuthoritative, true);
  assert.equal(controller.snapshot().lastSequence, 41);
});

test("a supported non-layer stream can become live with an explicitly unavailable layer", async () => {
  const coordinator = new FakeCoordinator({ capabilities: [1, 0, 0x01, 0, 20, 1, 0, 0] });
  const controller = new MobileTelemetryController(coordinator);
  await controller.whenSettled();
  coordinator.notify(fixtureFrame("key-down", (frame) => { frame[2] = BLE_KEYBOARD_FRAME_FLAGS.streamStart; }));
  assert.equal(controller.snapshot().status, TelemetryStatus.LIVE);
  assert.equal(controller.snapshot().activeLayer, null);
  assert.equal(controller.snapshot().layerAuthoritative, false);
  assert.deepEqual(controller.snapshot().pressedPositions, [1]);
});

test("sequence wrap is contiguous while gaps clear held keys and combos before later evidence", async () => {
  const { controller, coordinator } = await liveController();
  coordinator.notify(fixtureFrame("key-down", (frame) => { setSequence(frame, 42); }));
  coordinator.notify(fixtureFrame("combo-activated", (frame) => { setSequence(frame, 43); }));
  assert.deepEqual(controller.snapshot().pressedPositions, [1]);
  assert.equal(controller.snapshot().activeCombos.length, 1);

  coordinator.notify(fixtureFrame("key-down", (frame) => { setSequence(frame, 45); frame[9] = 7; }));
  assert.deepEqual(controller.snapshot().pressedPositions, [7]);
  assert.deepEqual(controller.snapshot().activeCombos, []);
  assert.deepEqual(controller.snapshot().diagnostics.at(-1), {
    code: "sequence-gap", expected: 44, actual: 45, distance: 1,
  });

  coordinator.notify(fixtureFrame("stream-start-layer-snapshot", (frame) => { setSequence(frame, 0xffffffff); }));
  coordinator.notify(fixtureFrame("key-down", (frame) => { setSequence(frame, 0); }));
  assert.equal(controller.snapshot().lastSequence, 0);
  assert.notEqual(controller.snapshot().diagnostics.at(-1)?.actual, 0);
});

test("key-up clears its physical position across authoritative layer changes", async () => {
  const { controller, coordinator } = await liveController();
  coordinator.notify(fixtureFrame("key-down"));
  coordinator.notify(fixtureFrame("stream-start-layer-snapshot", (frame) => {
    frame[2] = 0;
    setSequence(frame, 43);
    frame[8] = 13;
    frame[9] = 1;
    frame[10] = 1;
    frame[11] = 38;
  }));
  coordinator.notify(fixtureFrame("key-down", (frame) => { setSequence(frame, 44); frame[8] = 0; frame[10] = 13; }));
  assert.equal(controller.snapshot().activeLayer, 13);
  assert.deepEqual(controller.snapshot().pressedPositions, []);
});

test("combo release and the generation-scoped 800ms expiry both clear activation", async () => {
  const clock = fakeClock();
  const { controller, coordinator } = await liveController({ clock });
  coordinator.notify(fixtureFrame("combo-activated", (frame) => { setSequence(frame, 42); }));
  assert.equal(controller.snapshot().activeCombos[0].comboId, 1);
  assert.ok([...clock.timers.values()].some(({ delay }) => delay === COMBO_VISUAL_EXPIRY_MS));
  clock.fire(COMBO_VISUAL_EXPIRY_MS);
  assert.deepEqual(controller.snapshot().activeCombos, []);

  coordinator.notify(fixtureFrame("combo-activated", (frame) => { setSequence(frame, 43); }));
  coordinator.notify(fixtureFrame("combo-activated", (frame) => { setSequence(frame, 44); frame[10] = 0; }));
  assert.deepEqual(controller.snapshot().activeCombos, []);
  assert.equal(clock.timers.size, 0);
});

test("diagnostics are fixed-copy, numeric, immutable, and ring-bounded", async () => {
  const { controller, coordinator } = await liveController();
  for (let index = 0; index < TELEMETRY_DIAGNOSTIC_LIMIT + 2; index += 1) {
    coordinator.notify(fixtureFrame("queue-overflow-diagnostic", (frame) => {
      setSequence(frame, 42 + index);
      frame[8] = index === 0 ? 1 : 99;
      frame[9] = 0;
    }));
  }
  assert.equal(controller.snapshot().diagnostics.length, TELEMETRY_DIAGNOSTIC_LIMIT);
  const latest = controller.snapshot().diagnostics.at(-1);
  assert.equal(latest.code, "keyboard-diagnostic");
  assert.equal(latest.diagnosticCode, 99);
  assert.equal(latest.message, "Keyboard diagnostic 99.");
  assert.equal(Object.isFrozen(latest), true);
});

test("generation loss clears stream state, timers, diagnostics, and rejects stale callbacks", async () => {
  const clock = fakeClock();
  const { controller, coordinator } = await liveController({ clock });
  const staleHandler = coordinator.notificationHandler;
  coordinator.notify(fixtureFrame("key-down"));
  coordinator.notify(fixtureFrame("combo-activated", (frame) => { setSequence(frame, 43); }));
  coordinator.notify(fixtureFrame("queue-overflow-diagnostic", (frame) => { setSequence(frame, 44); }));
  coordinator.transition({ phase: LifecyclePhase.DISCONNECTED, generation: 2, capabilityMode: CapabilityMode.UNKNOWN });
  assert.equal(controller.snapshot().status, TelemetryStatus.STALE);
  assert.deepEqual(controller.snapshot().pressedPositions, []);
  assert.deepEqual(controller.snapshot().activeCombos, []);
  assert.deepEqual(controller.snapshot().diagnostics, []);
  assert.equal(clock.timers.size, 0);

  staleHandler({ bytes: [...fixtureFrame("key-down")] });
  assert.deepEqual(controller.snapshot().pressedPositions, []);
});

test("every non-ready lifecycle boundary clears only ephemeral current-generation Live state", async () => {
  for (const phase of [
    LifecyclePhase.SUSPENDED,
    LifecyclePhase.BLUETOOTH_UNAVAILABLE,
    LifecyclePhase.RECONNECTING,
    LifecyclePhase.DISCONNECTED,
    LifecyclePhase.FAILED,
  ]) {
    const { controller, coordinator } = await liveController();
    coordinator.notify(fixtureFrame("key-down"));
    coordinator.transition({ phase, generation: 2, capabilityMode: CapabilityMode.UNKNOWN });
    assert.deepEqual(controller.snapshot().pressedPositions, [], phase);
    assert.deepEqual(controller.snapshot().activeCombos, [], phase);
    assert.equal(controller.snapshot().activeLayer, null, phase);
    assert.equal(controller.snapshot().capabilities, null, phase);
  }
});

test("new stream boundaries replace transient state without reconnecting", async () => {
  const { controller, coordinator } = await liveController();
  coordinator.notify(fixtureFrame("key-down"));
  coordinator.notify(fixtureFrame("stream-start-layer-snapshot", (frame) => {
    setSequence(frame, 100);
    frame[8] = 13;
  }));
  assert.equal(coordinator.subscribeCalls, 1);
  assert.deepEqual(controller.snapshot().pressedPositions, []);
  assert.equal(controller.snapshot().activeLayer, 13);
  assert.equal(controller.snapshot().lastSequence, 100);
});

test("dispose removes lifecycle ownership and cancels all visual expiry work", async () => {
  const clock = fakeClock();
  const { controller, coordinator } = await liveController({ clock });
  coordinator.notify(fixtureFrame("combo-activated", (frame) => { setSequence(frame, 42); }));
  controller.dispose();
  assert.equal(clock.timers.size, 0);
  const before = controller.snapshot();
  coordinator.transition({ phase: LifecyclePhase.DISCONNECTED, generation: 2, capabilityMode: CapabilityMode.UNKNOWN });
  assert.equal(controller.snapshot(), before);
});
