import assert from "node:assert/strict";
import test from "node:test";

import { PermissionState } from "../src-mobile/ble_transport.js";
import {
  AppVisibility,
  BACKGROUND_DEBOUNCE_MS,
  BleLifecycleCoordinator,
  BluetoothAvailability,
  canExplicitReconnect,
  CapabilityMode,
  createLifecycleSnapshot,
  DesiredConnection,
  LifecycleError,
  LifecycleEvent,
  LifecyclePhase,
  RECONNECT_DELAYS_MS,
  reduceLifecycle,
  SYSTEM_INTERACTION_LEASE_MS,
} from "../src-mobile/ble_lifecycle.js";

const extensionServiceUuid = "b34a0001-e782-4706-8f9c-6c056c416507";

function fakeClock() {
  let id = 0;
  const scheduled = new Map();
  return {
    scheduled,
    schedule(handler, delay) {
      const timer = ++id;
      scheduled.set(timer, { handler, delay });
      return timer;
    },
    cancel(timer) { scheduled.delete(timer); },
    async fireDelay(delay, coordinator) {
      const entry = [...scheduled.entries()].find(([, value]) => value.delay === delay);
      assert.ok(entry, `expected a ${delay}ms timer`);
      scheduled.delete(entry[0]);
      entry[1].handler();
      for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
        await coordinator.queue;
      }
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

class FakeTransport {
  constructor() {
    this.permission = PermissionState.GRANTED;
    this.availability = { state: BluetoothAvailability.AVAILABLE, supported: true };
    this.connectionAttempt = 0;
    this.lossHandler = null;
    this.availabilityHandler = null;
    this.calls = [];
    this.services = [{
      uuid: extensionServiceUuid,
      characteristics: [{ uuid: "b34a0003-e782-4706-8f9c-6c056c416507" }],
    }];
    this.connectFailures = [];
  }

  snapshot() { return { connectionAttempt: this.connectionAttempt }; }
  async checkPermission({ request = false } = {}) { this.calls.push(["permission", request]); return this.permission; }
  async checkBluetoothAvailability() { this.calls.push(["availability"]); return this.availability; }
  async observeBluetoothAvailability(handler) { this.availabilityHandler = handler; return () => { this.availabilityHandler = null; }; }
  onConnectionLoss(handler) { this.lossHandler = handler; return () => { this.lossHandler = null; }; }
  async startScan({ onDevices }) { this.calls.push(["scan"]); this.scanHandler = onDevices; }
  async stopScan() { this.calls.push(["stop-scan"]); }
  async connect(id) {
    this.calls.push(["connect", id]);
    this.connectionAttempt += 1;
    const failure = this.connectFailures.shift();
    if (failure) throw failure;
  }
  async discoverServices() { this.calls.push(["discover"]); return this.services; }
  async disconnect() { this.calls.push(["disconnect"]); this.connectionAttempt += 1; }
  async read() { this.calls.push(["read"]); return [81]; }
  async subscribe(_service, _characteristic, handler) { this.notificationHandler = handler; }
}

async function readyCoordinator({ services, clock = fakeClock() } = {}) {
  const transport = new FakeTransport();
  if (services) transport.services = services;
  const coordinator = new BleLifecycleCoordinator(transport, {
    extensionServiceUuid,
    capabilitiesCharacteristicUuid: "b34a0003-e782-4706-8f9c-6c056c416507",
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  });
  await coordinator.initialize();
  await coordinator.selectDevice({ id: "keyboard", name: "Keyboard" });
  await coordinator.connectSelected();
  return { coordinator, transport, clock };
}

test("cold snapshots are immutable, serializable, and contain no restored ownership", () => {
  const snapshot = createLifecycleSnapshot();
  assert.equal(snapshot.phase, LifecyclePhase.IDLE);
  assert.equal(snapshot.selectedDevice, null);
  assert.equal(snapshot.desiredConnection, DesiredConnection.NONE);
  assert.equal(snapshot.retry.attempt, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.retry));
});

test("pure reducer rejects illegal actions and preserves orthogonal platform facts", () => {
  const cold = createLifecycleSnapshot();
  assert.throws(() => reduceLifecycle(cold, { type: LifecycleEvent.SCAN_REQUESTED }), LifecycleError);
  const observed = reduceLifecycle(cold, {
    type: LifecycleEvent.PLATFORM_OBSERVED,
    permission: PermissionState.GRANTED,
    availability: BluetoothAvailability.UNAVAILABLE,
  }).snapshot;
  assert.equal(observed.phase, LifecyclePhase.BLUETOOTH_UNAVAILABLE);
  assert.equal(observed.permission, PermissionState.GRANTED);
  assert.equal(observed.bluetoothAvailability, BluetoothAvailability.UNAVAILABLE);
});

test("reducer table covers every lifecycle phase and rejects representative illegal actions", () => {
  const device = { id: "keyboard", name: "Keyboard" };
  const readyFacts = { permission: PermissionState.GRANTED, bluetoothAvailability: BluetoothAvailability.AVAILABLE };
  const cases = [
    [LifecyclePhase.IDLE, createLifecycleSnapshot(), { type: LifecycleEvent.SCAN_STOPPED }],
    [LifecyclePhase.PERMISSION_REQUIRED, createLifecycleSnapshot({ phase: LifecyclePhase.PERMISSION_REQUIRED }), { type: LifecycleEvent.CONNECT_REQUESTED }],
    [LifecyclePhase.SCANNING, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.SCANNING }), { type: LifecycleEvent.DISCOVERY_SUCCEEDED, capabilityMode: CapabilityMode.STOCK }],
    [LifecyclePhase.CONNECTING, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.CONNECTING, selectedDevice: device, desiredConnection: DesiredConnection.CONNECTED }), { type: LifecycleEvent.SCAN_REQUESTED }],
    [LifecyclePhase.DISCOVERING, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.DISCOVERING, selectedDevice: device, desiredConnection: DesiredConnection.CONNECTED }), { type: LifecycleEvent.CONNECT_REQUESTED }],
    [LifecyclePhase.READY, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.READY, selectedDevice: device, desiredConnection: DesiredConnection.CONNECTED, capabilityMode: CapabilityMode.STOCK }), { type: LifecycleEvent.SCAN_REQUESTED }],
    [LifecyclePhase.RECONNECTING, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.RECONNECTING, selectedDevice: device, desiredConnection: DesiredConnection.CONNECTED, retry: { attempt: 1, limit: 3 } }), { type: LifecycleEvent.SCAN_REQUESTED }],
    [LifecyclePhase.SUSPENDED, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.SUSPENDED, visibility: AppVisibility.BACKGROUND, selectedDevice: device, desiredConnection: DesiredConnection.CONNECTED }), { type: LifecycleEvent.CONNECT_REQUESTED }],
    [LifecyclePhase.DISCONNECTED, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.DISCONNECTED }), { type: LifecycleEvent.DISCOVERY_SUCCEEDED, capabilityMode: CapabilityMode.STOCK }],
    [LifecyclePhase.BLUETOOTH_UNAVAILABLE, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.BLUETOOTH_UNAVAILABLE, bluetoothAvailability: BluetoothAvailability.UNAVAILABLE }), { type: LifecycleEvent.SCAN_REQUESTED }],
    [LifecyclePhase.UNSUPPORTED, createLifecycleSnapshot({ phase: LifecyclePhase.UNSUPPORTED, bluetoothSupported: false }), { type: LifecycleEvent.SCAN_REQUESTED }],
    [LifecyclePhase.CAPACITY_UNAVAILABLE, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.CAPACITY_UNAVAILABLE, selectedDevice: device, desiredConnection: DesiredConnection.CONNECTED }), { type: LifecycleEvent.CONNECT_REQUESTED }],
    [LifecyclePhase.FAILED, createLifecycleSnapshot({ ...readyFacts, phase: LifecyclePhase.FAILED }), { type: LifecycleEvent.DISCOVERY_SUCCEEDED, capabilityMode: CapabilityMode.STOCK }],
  ];
  for (const [phase, snapshot, event] of cases) {
    assert.equal(snapshot.phase, phase);
    assert.throws(() => reduceLifecycle(snapshot, event), LifecycleError, phase);
  }

  let snapshot = createLifecycleSnapshot();
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.PLATFORM_OBSERVED, permission: PermissionState.GRANTED, availability: BluetoothAvailability.AVAILABLE }).snapshot;
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.SCAN_REQUESTED, timeoutMs: 1000 }).snapshot;
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.DEVICE_SELECTED, device }).snapshot;
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.CONNECT_REQUESTED }).snapshot;
  assert.equal(snapshot.phase, LifecyclePhase.CONNECTING);
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.CONNECT_SUCCEEDED }).snapshot;
  assert.equal(snapshot.phase, LifecyclePhase.DISCOVERING);
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.DISCOVERY_SUCCEEDED, capabilityMode: CapabilityMode.ENHANCED }).snapshot;
  assert.equal(snapshot.phase, LifecyclePhase.READY);
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.CONNECTION_LOST }).snapshot;
  assert.equal(snapshot.phase, LifecyclePhase.RECONNECTING);
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.DISCONNECT_REQUESTED }).snapshot;
  assert.equal(snapshot.phase, LifecyclePhase.DISCONNECTED);
  snapshot = reduceLifecycle(snapshot, { type: LifecycleEvent.OPERATION_FAILED, reason: { code: "failed", message: "failed" } }).snapshot;
  assert.equal(snapshot.phase, LifecyclePhase.FAILED);
});

test("terminal errors normalize facts and stale operation failures cannot replace current state", () => {
  const selected = createLifecycleSnapshot({
    permission: PermissionState.GRANTED,
    bluetoothAvailability: BluetoothAvailability.AVAILABLE,
    phase: LifecyclePhase.CONNECTING,
    selectedDevice: { id: "keyboard", name: "Keyboard" },
    desiredConnection: DesiredConnection.CONNECTED,
    generation: 4,
  });
  const stale = reduceLifecycle(selected, { type: LifecycleEvent.OPERATION_FAILED, generation: 3, reason: { code: "connection-failed", message: "old" } }).snapshot;
  assert.equal(stale.phase, LifecyclePhase.CONNECTING);
  const capacity = reduceLifecycle(selected, { type: LifecycleEvent.OPERATION_FAILED, generation: 4, reason: { code: "capacity-unavailable", message: "full" } }).snapshot;
  assert.equal(capacity.phase, LifecyclePhase.CAPACITY_UNAVAILABLE);
  const unsupported = reduceLifecycle(selected, { type: LifecycleEvent.OPERATION_FAILED, generation: 4, reason: { code: "unsupported", message: "no adapter" } }).snapshot;
  assert.equal(unsupported.phase, LifecyclePhase.UNSUPPORTED);
  assert.equal(unsupported.bluetoothSupported, false);
});

test("selected connect is serialized through discovery into enhanced readiness", async () => {
  const { coordinator, transport } = await readyCoordinator();
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.equal(coordinator.snapshot().desiredConnection, DesiredConnection.CONNECTED);
  assert.equal(coordinator.snapshot().capabilityMode, CapabilityMode.ENHANCED);
  assert.deepEqual(coordinator.capabilities, [81]);
  assert.deepEqual(transport.calls.filter(([name]) => ["connect", "discover"].includes(name)), [
    ["connect", "keyboard"],
    ["discover"],
  ]);
});

test("bounded scan returns the coordinator to idle and clears its timer", async () => {
  const transport = new FakeTransport();
  const clock = fakeClock();
  const coordinator = new BleLifecycleCoordinator(transport, {
    extensionServiceUuid,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  });
  await coordinator.initialize();
  await coordinator.startScan(2_500);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.SCANNING);
  await clock.fireDelay(2_500, coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.IDLE);
  assert.equal(clock.scheduled.size, 0);
  assert.ok(transport.calls.some(([name]) => name === "stop-scan"));
});

test("stock discovery remains ready and does not become unsupported", async () => {
  const { coordinator } = await readyCoordinator({ services: [{ uuid: "0000180f-0000-1000-8000-00805f9b34fb" }] });
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.equal(coordinator.snapshot().capabilityMode, CapabilityMode.STOCK);
});

test("an extension service without v1 capabilities remains ready as extension-incomplete stock", async () => {
  const { coordinator, transport } = await readyCoordinator({
    services: [{ uuid: extensionServiceUuid, characteristics: [{ uuid: "b34a0002-e782-4706-8f9c-6c056c416507" }] }],
  });
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.equal(coordinator.snapshot().capabilityMode, CapabilityMode.STOCK);
  assert.deepEqual(coordinator.capabilities, []);
  assert.equal(transport.calls.filter(([name]) => name === "read").length, 0);
});

test("unexpected loss uses exactly 500, 1500, and 3000ms before exhaustion", async () => {
  const { coordinator, transport, clock } = await readyCoordinator();
  transport.connectFailures.push(new Error("connection failed"), new Error("connection failed"), new Error("connection failed"));
  transport.lossHandler({ code: "connection-lost", message: "gone" });
  await coordinator.queue;

  for (const delay of RECONNECT_DELAYS_MS) await clock.fireDelay(delay, coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.DISCONNECTED);
  assert.equal(coordinator.snapshot().reason.code, "reconnect-exhausted");
  assert.equal(coordinator.snapshot().desiredConnection, DesiredConnection.CONNECTED);
  assert.equal(canExplicitReconnect(coordinator.snapshot()), true);
  assert.equal(clock.scheduled.size, 0);
  assert.equal(transport.calls.filter(([name]) => name === "connect").length, 4);
  const reconnectIndex = transport.calls.findIndex(([name], index) => name === "connect" && index > 3);
  assert.equal(transport.calls[reconnectIndex - 2][0], "stop-scan");
  assert.equal(transport.calls[reconnectIndex - 1][0], "disconnect");

  await coordinator.connectSelected();
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.equal(coordinator.snapshot().retry.attempt, 0);
});

test("successful reconnect resets the retry budget and explicit disconnect suppresses restart", async () => {
  const { coordinator, transport, clock } = await readyCoordinator();
  transport.lossHandler({ code: "connection-lost", message: "gone" });
  await coordinator.queue;
  await clock.fireDelay(RECONNECT_DELAYS_MS[0], coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.equal(coordinator.snapshot().retry.attempt, 0);

  await coordinator.disconnect();
  transport.lossHandler?.({ code: "connection-lost", message: "late callback" });
  await coordinator.queue;
  assert.equal(coordinator.snapshot().desiredConnection, DesiredConnection.NONE);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.DISCONNECTED);
  assert.equal(clock.scheduled.size, 0);
});

test("background debounce cleans up and foreground resumes process-local intent", async () => {
  const { coordinator, transport, clock } = await readyCoordinator();
  const generations = [];
  coordinator.onGenerationChange((generation) => generations.push(generation));
  await coordinator.setVisibility(AppVisibility.BACKGROUND);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  await clock.fireDelay(BACKGROUND_DEBOUNCE_MS, coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.SUSPENDED);
  assert.equal(coordinator.snapshot().selectedDevice.id, "keyboard");
  assert.ok(transport.calls.some(([name]) => name === "disconnect"));

  await coordinator.setVisibility(AppVisibility.FOREGROUND);
  await clock.fireDelay(RECONNECT_DELAYS_MS[0], coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.ok(generations.length >= 2);
});

test("system interaction lease delays background cleanup and expires at 30 seconds", async () => {
  const { coordinator, clock } = await readyCoordinator();
  await coordinator.dispatch({ type: LifecycleEvent.LEASE_ACQUIRED });
  await coordinator.setVisibility(AppVisibility.BACKGROUND);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.ok([...clock.scheduled.values()].some(({ delay }) => delay === SYSTEM_INTERACTION_LEASE_MS));
  await clock.fireDelay(SYSTEM_INTERACTION_LEASE_MS, coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.SUSPENDED);
});

test("a pending native permission prompt does not block lease expiry or background cleanup", async () => {
  const transport = new FakeTransport();
  transport.permission = PermissionState.PROMPT;
  const prompt = deferred();
  transport.checkPermission = async ({ request = false } = {}) => {
    transport.calls.push(["permission", request]);
    return request ? prompt.promise : PermissionState.PROMPT;
  };
  const clock = fakeClock();
  const coordinator = new BleLifecycleCoordinator(transport, {
    extensionServiceUuid,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  });
  await coordinator.initialize();

  const permissionRequest = coordinator.requestPermission();
  await Promise.resolve();
  await coordinator.setVisibility(AppVisibility.BACKGROUND);
  assert.equal(coordinator.snapshot().systemInteractionLease, true);
  await clock.fireDelay(SYSTEM_INTERACTION_LEASE_MS, coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.SUSPENDED);

  prompt.resolve(PermissionState.GRANTED);
  await permissionRequest;
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.SUSPENDED);
  assert.equal(coordinator.snapshot().permission, PermissionState.PROMPT);
});

test("duplicate visibility events are idempotent", async () => {
  const { coordinator, clock } = await readyCoordinator();
  await coordinator.setVisibility(AppVisibility.FOREGROUND);
  assert.equal(clock.scheduled.size, 0);
  await coordinator.setVisibility(AppVisibility.BACKGROUND);
  const timerCount = clock.scheduled.size;
  await coordinator.setVisibility(AppVisibility.BACKGROUND);
  assert.equal(clock.scheduled.size, timerCount);
});

test("Bluetooth loss cancels retry and recovery never prompts or scans", async () => {
  const { coordinator, transport, clock } = await readyCoordinator();
  transport.lossHandler({ code: "connection-lost", message: "gone" });
  await coordinator.queue;
  transport.availabilityHandler({ state: BluetoothAvailability.UNAVAILABLE, supported: true });
  await coordinator.queue;
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.BLUETOOTH_UNAVAILABLE);
  assert.equal(clock.scheduled.size, 0);

  transport.availabilityHandler({ state: BluetoothAvailability.AVAILABLE, supported: true });
  await coordinator.queue;
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.RECONNECTING);
  await clock.fireDelay(RECONNECT_DELAYS_MS[0], coordinator);
  assert.equal(coordinator.snapshot().phase, LifecyclePhase.READY);
  assert.equal(transport.calls.filter(([name]) => name === "permission" && transport.calls.at(-1)?.[1]).length, 0);
  assert.equal(transport.calls.filter(([name]) => name === "scan").length, 0);
});

test("generation changes filter stale notifications", async () => {
  const { coordinator, transport } = await readyCoordinator();
  const values = [];
  await coordinator.subscribeNotifications(extensionServiceUuid, "b34a0004-e782-4706-8f9c-6c056c416507", (event) => values.push(event));
  transport.notificationHandler({ bytes: [1] });
  await coordinator.disconnect();
  transport.notificationHandler({ bytes: [2] });
  assert.deepEqual(values, [{ bytes: [1] }]);
});

test("ready reads and CCC enrollment share one lifecycle-owned GATT queue", async () => {
  const { coordinator, transport } = await readyCoordinator();
  const gate = deferred();
  const calls = [];
  transport.read = async () => {
    calls.push("read-start");
    await gate.promise;
    calls.push("read-end");
    return [81];
  };
  transport.subscribe = async (_service, _characteristic, handler) => {
    calls.push("enroll");
    transport.notificationHandler = handler;
    return { subscribed: true };
  };

  const read = coordinator.read("180f", "2a19");
  const enrollment = coordinator.subscribeNotifications(extensionServiceUuid, "b34a0004-e782-4706-8f9c-6c056c416507");
  await Promise.resolve();
  assert.deepEqual(calls, ["read-start"]);
  gate.resolve();
  assert.deepEqual(await read, [81]);
  assert.deepEqual(await enrollment, { subscribed: true });
  assert.deepEqual(calls, ["read-start", "read-end", "enroll"]);

  transport.read = async () => { calls.push("later-read"); return [82]; };
  assert.deepEqual(await coordinator.read("180f", "2a19"), [82]);
  assert.equal(calls.at(-1), "later-read");
});

test("disconnect invalidates running and queued ready-generation GATT operations", async () => {
  const { coordinator, transport } = await readyCoordinator();
  const gate = deferred();
  let enrollmentStarted = false;
  transport.read = () => gate.promise;
  transport.subscribe = async () => { enrollmentStarted = true; };

  const read = coordinator.read("180f", "2a19");
  const enrollment = coordinator.subscribeNotifications(extensionServiceUuid, "b34a0004-e782-4706-8f9c-6c056c416507");
  await Promise.resolve();
  await coordinator.disconnect();
  gate.resolve([81]);

  await assert.rejects(read, (error) => error.code === "stale-operation");
  await assert.rejects(enrollment, (error) => error.code === "stale-operation");
  assert.equal(enrollmentStarted, false);
});
