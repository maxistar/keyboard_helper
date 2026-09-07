import assert from "node:assert/strict";
import test from "node:test";

import { NativeBleAdapter } from "../src-mobile/native_ble_adapter.js";

class FakeChannel {
  onmessage = null;
}

function createTauri(responses = new Map()) {
  const calls = [];
  return {
    calls,
    tauri: {
      core: {
        Channel: FakeChannel,
        async invoke(command, args) {
          calls.push([command, args]);
          return responses.get(command);
        },
      },
    },
  };
}

test("native adapter preserves the platform permission prompt state", async () => {
  const command = "plugin:keyboard-helper-ble|permission_status";
  const { tauri } = createTauri(new Map([[command, { state: "prompt", sdkInt: 36 }]]));
  const adapter = new NativeBleAdapter(tauri);

  assert.equal(await adapter.checkPermissions(false), "prompt");
});

test("native adapter deduplicates scan events before exposing discoveries", async () => {
  const { tauri, calls } = createTauri();
  const adapter = new NativeBleAdapter(tauri);
  const snapshots = [];
  await adapter.startScan((devices) => snapshots.push(devices), 2500);

  const channel = calls[0][1].onEvent;
  channel.onmessage({ kind: "device", device: { address: "one", name: "Old" } });
  channel.onmessage({ kind: "device", device: { address: "one", name: "New" } });

  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[1], [{ address: "one", name: "New" }]);
  assert.deepEqual(calls[0].slice(0, 1), ["plugin:keyboard-helper-ble|start_scan"]);
  assert.equal(calls[0][1].timeoutMs, 2500);
});

test("native adapter tags connection, GATT and notification calls with one attempt", async () => {
  const servicesCommand = "plugin:keyboard-helper-ble|list_services";
  const readCommand = "plugin:keyboard-helper-ble|read";
  const { tauri, calls } = createTauri(
    new Map([
      [servicesCommand, [{ uuid: "service", characteristics: [] }]],
      [readCommand, [42]],
    ]),
  );
  const adapter = new NativeBleAdapter(tauri);
  let disconnected = false;
  await adapter.connect("AA:BB", () => {
    disconnected = true;
  });
  assert.deepEqual(await adapter.listServices("AA:BB"), [
    { uuid: "service", characteristics: [] },
  ]);
  assert.deepEqual(await adapter.read("characteristic", "service"), [42]);

  const notifications = [];
  await adapter.subscribe("characteristic", "service", (bytes) => notifications.push(bytes));
  const connectCall = calls.find(([command]) => command.endsWith("|connect"));
  const subscribeCall = calls.find(([command]) => command.endsWith("|subscribe"));
  connectCall[1].onDisconnect.onmessage({ attempt: 1 });
  subscribeCall[1].onNotification.onmessage({ attempt: 1, bytes: [1, 2] });

  assert.equal(disconnected, true);
  assert.deepEqual(notifications, [[1, 2]]);
  for (const [, args] of calls.filter(([, args]) => args?.attempt)) assert.equal(args.attempt, 1);
});

test("native adapter advances its generation after explicit disconnect", async () => {
  const { tauri, calls } = createTauri();
  const adapter = new NativeBleAdapter(tauri);
  await adapter.connect("AA:BB", () => {});
  await adapter.disconnect();
  await adapter.connect("AA:BB", () => {});

  const attempts = calls
    .filter(([command]) => command.endsWith("|connect"))
    .map(([, args]) => args.attempt);
  assert.deepEqual(attempts, [1, 3]);
});
