import assert from "node:assert/strict";
import test from "node:test";

import {
  AndroidBleTransport,
  BleTransportError,
  ConnectionState,
  PermissionState,
  normalizeBytes,
  normalizeDevice,
  normalizeUuid,
} from "../src-mobile/ble_transport.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeAdapter {
  constructor() {
    this.permission = true;
    this.devicesHandler = null;
    this.disconnectHandler = null;
    this.notificationHandler = null;
    this.calls = [];
    this.services = [];
    this.readValue = [];
  }

  async checkPermissions(request) {
    this.calls.push(["permission", request]);
    return this.permission;
  }

  async startScan(handler, timeoutMs) {
    this.calls.push(["startScan", timeoutMs]);
    this.devicesHandler = handler;
  }

  async stopScan() {
    this.calls.push(["stopScan"]);
  }

  async connect(id, onDisconnect) {
    this.calls.push(["connect", id]);
    this.disconnectHandler = onDisconnect;
  }

  async disconnect() {
    this.calls.push(["disconnect"]);
  }

  async listServices(id) {
    this.calls.push(["listServices", id]);
    return this.services;
  }

  async read(characteristic, service) {
    this.calls.push(["read", characteristic, service]);
    return this.readValue;
  }

  async subscribe(characteristic, service, handler) {
    this.calls.push(["subscribe", characteristic, service]);
    this.notificationHandler = handler;
  }

  async unsubscribe(characteristic, service) {
    this.calls.push(["unsubscribe", characteristic, service]);
  }
}

test("normalizes public transport values without leaking adapter objects", () => {
  assert.equal(normalizeUuid("180F"), "0000180f-0000-1000-8000-00805f9b34fb");
  assert.equal(
    normalizeUuid("B34A0004-E782-4706-8F9C-6C056C416507"),
    "b34a0004-e782-4706-8f9c-6c056c416507",
  );
  assert.deepEqual(normalizeBytes(new Uint8Array([0, 127, 255])), [0, 127, 255]);
  assert.deepEqual(normalizeDevice({ address: "AA:BB", name: "", rssi: -54 }), {
    id: "AA:BB",
    name: "Unnamed device",
    rssi: -54,
    connected: false,
    bonded: false,
    advertisedServices: [],
  });
  assert.throws(() => normalizeBytes([256]), BleTransportError);
});

test("maps repeated denied requests to an actionable permanent-denial state", async () => {
  const adapter = new FakeAdapter();
  const transport = new AndroidBleTransport(adapter);
  adapter.permission = false;

  assert.equal(await transport.checkPermission({ request: true }), PermissionState.DENIED);
  assert.equal(
    await transport.checkPermission({ request: true }),
    PermissionState.PERMANENTLY_DENIED,
  );
  adapter.permission = true;
  assert.equal(await transport.checkPermission(), PermissionState.GRANTED);
});

test("preserves the first-request permission prompt state", async () => {
  const adapter = new FakeAdapter();
  const transport = new AndroidBleTransport(adapter);
  adapter.permission = PermissionState.PROMPT;

  assert.equal(await transport.checkPermission(), PermissionState.PROMPT);
});

test("deduplicates discoveries and stops a bounded scan", async () => {
  const adapter = new FakeAdapter();
  let scheduled;
  const transport = new AndroidBleTransport(adapter, {
    schedule(handler) {
      scheduled = handler;
      return 7;
    },
    cancelSchedule() {},
  });
  await transport.checkPermission();
  await transport.startScan({ timeoutMs: 2500 });
  adapter.devicesHandler([
    { address: "one", name: "First", rssi: -80 },
    { address: "one", name: "Updated", rssi: -42 },
  ]);

  assert.equal(transport.snapshot().devices.length, 1);
  assert.equal(transport.snapshot().devices[0].name, "Updated");
  await scheduled();
  assert.equal(transport.snapshot().scanning, false);
  assert.deepEqual(adapter.calls.at(-1), ["stopScan"]);
});

test("an empty scan remains a valid bounded result", async () => {
  const adapter = new FakeAdapter();
  const transport = new AndroidBleTransport(adapter);
  await transport.checkPermission();
  await transport.startScan({ timeoutMs: 2500 });

  adapter.devicesHandler([]);
  assert.deepEqual(transport.snapshot().devices, []);
  assert.equal(transport.snapshot().scanning, true);

  await transport.stopScan();
  assert.equal(transport.snapshot().scanning, false);
});

test("guards incompatible scan and connection operations", async () => {
  const adapter = new FakeAdapter();
  const transport = new AndroidBleTransport(adapter);

  await assert.rejects(() => transport.startScan(), { code: "permission-required" });
  await transport.checkPermission();
  await transport.connect("keyboard");
  await assert.rejects(() => transport.startScan(), { code: "invalid-state" });
  await assert.rejects(() => transport.connect("other"), { code: "invalid-state" });
});

test("connection failures retain their category and failed state", async () => {
  const adapter = new FakeAdapter();
  adapter.connect = async () => {
    throw new Error("GATT connection rejected");
  };
  const transport = new AndroidBleTransport(adapter);

  await assert.rejects(() => transport.connect("keyboard"), { code: "connection-failed" });
  assert.equal(transport.snapshot().connection, ConnectionState.FAILED);
  assert.equal(transport.snapshot().connectedDeviceId, null);
});

test("rejects stale connection completion and ignores stale disconnect callbacks", async () => {
  const adapter = new FakeAdapter();
  const pending = deferred();
  let firstDisconnect;
  adapter.connect = async (_id, onDisconnect) => {
    firstDisconnect = onDisconnect;
    await pending.promise;
  };
  const transport = new AndroidBleTransport(adapter);
  const connecting = transport.connect("keyboard");
  await transport.disconnect();
  pending.resolve();

  await assert.rejects(connecting, { code: "stale-operation" });
  assert.equal(firstDisconnect(), false);
  assert.equal(transport.connection, ConnectionState.DISCONNECTED);
});

test("normalizes GATT reads and filters notifications from inactive attempts", async () => {
  const adapter = new FakeAdapter();
  adapter.services = [
    {
      uuid: "180f",
      characteristics: [{ uuid: "2a19", descriptors: [], properties: 2 }],
    },
  ];
  adapter.readValue = new Uint8Array([91]);
  const transport = new AndroidBleTransport(adapter);
  await transport.connect("keyboard");

  const services = await transport.discoverServices();
  assert.equal(services[0].uuid, "0000180f-0000-1000-8000-00805f9b34fb");
  assert.deepEqual(await transport.read("180f", "2a19"), [91]);

  const notifications = [];
  await transport.subscribe("b34a0001-e782-4706-8f9c-6c056c416507", "b34a0004-e782-4706-8f9c-6c056c416507", (event) => notifications.push(event));
  adapter.notificationHandler([1, 2, 3]);
  await transport.disconnect();
  adapter.notificationHandler([4, 5, 6]);

  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0].bytes, [1, 2, 3]);
  assert.deepEqual(adapter.calls.slice(-2).map(([name]) => name), ["unsubscribe", "disconnect"]);
});

test("subscription security failures stay distinct from discovery failures", async () => {
  const adapter = new FakeAdapter();
  adapter.subscribe = async () => {
    throw new Error("insufficient authentication: pairing required");
  };
  const transport = new AndroidBleTransport(adapter);
  await transport.connect("keyboard");

  await assert.rejects(
    () =>
      transport.subscribe(
        "b34a0001-e782-4706-8f9c-6c056c416507",
        "b34a0004-e782-4706-8f9c-6c056c416507",
      ),
    { code: "security-required" },
  );
  assert.equal(transport.snapshot().connection, ConnectionState.CONNECTED);
});

test("explicit reconnect starts a fresh connection attempt", async () => {
  const adapter = new FakeAdapter();
  const transport = new AndroidBleTransport(adapter);
  await transport.connect("keyboard");
  const firstAttempt = transport.connectionAttempt;
  await transport.disconnect();
  await transport.reconnect();

  assert.equal(transport.connectedDeviceId, "keyboard");
  assert.equal(transport.connection, ConnectionState.CONNECTED);
  assert.ok(transport.connectionAttempt > firstAttempt);
  assert.deepEqual(
    adapter.calls.filter(([name]) => name === "connect"),
    [
      ["connect", "keyboard"],
      ["connect", "keyboard"],
    ],
  );
});

function fakeClock() {
  let id = 0;
  const timers = new Map();
  return {
    timers,
    schedule(handler, delay) { const timer = ++id; timers.set(timer, { handler, delay }); return timer; },
    cancelSchedule(timer) { timers.delete(timer); },
    fire(delay) {
      const entry = [...timers.entries()].find(([, value]) => value.delay === delay);
      assert.ok(entry, `expected a ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].handler();
    },
  };
}

async function connectedTransport(adapter = new FakeAdapter()) {
  const clock = fakeClock();
  const transport = new AndroidBleTransport(adapter, { schedule: clock.schedule, cancelSchedule: clock.cancelSchedule });
  adapter.permission = "granted";
  await transport.checkPermission();
  await transport.connect("AA:BB");
  return { adapter, clock, transport };
}

test("a scan failure after start finishes the scan and reaches the caller as a structured error", async () => {
  const adapter = new FakeAdapter();
  adapter.startScan = async (_handler, _timeoutMs, onError) => { adapter.scanError = onError; };
  const clock = fakeClock();
  const transport = new AndroidBleTransport(adapter, { schedule: clock.schedule, cancelSchedule: clock.cancelSchedule });
  adapter.permission = "granted";
  await transport.checkPermission();
  const errors = [];
  await transport.startScan({ timeoutMs: 5000, onError: (error) => errors.push(error) });
  assert.equal(transport.snapshot().scanning, true);

  adapter.scanError(new Error("scan-6: Android BLE scan failed with code 6"));
  assert.equal(transport.snapshot().scanning, false);
  assert.equal(clock.timers.size, 0, "the scan timer is cleared");
  assert.equal(errors[0].code, "scan-throttled");

  await transport.startScan({ timeoutMs: 5000, onError: (error) => errors.push(error) });
  adapter.scanError(new Error("scan-3: internal error"));
  assert.equal(errors[1].code, "scan-failed");

  adapter.scanError(new Error("scan-3: after the scan ended"));
  assert.equal(errors.length, 2, "an error after the scan ended is ignored");
});

test("native operations receive their deadlines and the backstop fires after the native deadline", async () => {
  const cases = [
    ["connect", 20000, (t) => t.connect("AA:BB"), "connect"],
    ["listServices", 10000, (t) => t.discoverServices(), "discover"],
    ["read", 5000, (t) => t.read("180f", "2a19"), "read"],
    ["subscribe", 8000, (t) => t.subscribe("b34a0001-e782-4706-8f9c-6c056c416507", "b34a0004-e782-4706-8f9c-6c056c416507"), "subscribe"],
  ];
  for (const [method, nativeMs, run, label] of cases) {
    const adapter = new FakeAdapter();
    const received = [];
    let hang = false;
    const original = adapter[method].bind(adapter);
    adapter[method] = (...args) => {
      received.push(args.at(-1));
      return hang ? new Promise(() => {}) : original(...args);
    };
    const { transport, clock } = await connectedTransport(adapter);
    if (method === "connect") {
      // the first connect inside connectedTransport completed; start a fresh transport for the hanging one
    }
    hang = true;
    const target = method === "connect" ? new AndroidBleTransport(adapter, { schedule: clock.schedule, cancelSchedule: clock.cancelSchedule }) : transport;
    if (method === "connect") { adapter.permission = "granted"; await target.checkPermission(); }
    const pending = run(target);
    const settled = assert.rejects(pending, (error) => error.code === "timeout");
    assert.deepEqual(received.at(-1), { timeoutMs: nativeMs }, `${label} passes its deadline to the native layer`);
    clock.fire(nativeMs + 2000);
    await settled;
    assert.ok(adapter.calls.some(([name]) => name === "disconnect"), `${label} backstop requests a disconnect`);
    assert.equal([...clock.timers.values()].some(({ delay }) => delay === nativeMs + 2000), false, `${label} timer is cleared`);
  }
});

test("a native timeout is reported without the backstop disconnect and a late result is ignored", async () => {
  const adapter = new FakeAdapter();
  const { transport, clock } = await connectedTransport(adapter);
  adapter.calls.length = 0;
  const late = deferred();
  adapter.read = () => late.promise;
  const pending = transport.read("180f", "2a19");
  const settled = assert.rejects(pending, (error) => error.code === "timeout");
  late.reject(new Error("timeout: characteristic read timed out"));
  await settled;
  assert.equal(adapter.calls.some(([name]) => name === "disconnect"), false);
  assert.equal(clock.timers.size, 0);

  const second = deferred();
  adapter.read = () => second.promise;
  const next = transport.read("180f", "2a19");
  second.resolve([7]);
  assert.deepEqual(await next, [7], "the previous read's timeout does not affect a later read");
});

test("a connect that completes after its backstop does not revive the connection", async () => {
  const adapter = new FakeAdapter();
  const clock = fakeClock();
  const gate = deferred();
  adapter.connect = async () => { await gate.promise; };
  const transport = new AndroidBleTransport(adapter, { schedule: clock.schedule, cancelSchedule: clock.cancelSchedule });
  adapter.permission = "granted";
  await transport.checkPermission();
  const pending = transport.connect("AA:BB");
  const settled = assert.rejects(pending, (error) => error.code === "timeout");
  clock.fire(22000);
  await settled;
  assert.equal(transport.snapshot().connection, ConnectionState.FAILED);
  gate.resolve();
  await Promise.resolve();
  assert.equal(transport.snapshot().connection, ConnectionState.FAILED);
});

test("a scan start refused as throttled keeps its reason and leaves no scan running", async () => {
  const adapter = new FakeAdapter();
  adapter.startScan = async () => { throw new Error("scan-throttled: Android allows five scans per 30 seconds; try again in 12 s"); };
  const clock = fakeClock();
  const transport = new AndroidBleTransport(adapter, { schedule: clock.schedule, cancelSchedule: clock.cancelSchedule });
  adapter.permission = "granted";
  await transport.checkPermission();

  await assert.rejects(transport.startScan({ timeoutMs: 5000 }), (error) => error.code === "scan-throttled");
  assert.equal(transport.snapshot().scanning, false);
  assert.equal(clock.timers.size, 0);
});
