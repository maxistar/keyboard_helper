import assert from "node:assert/strict";
import test from "node:test";

import { PermissionState } from "../src-mobile/ble_transport.js";
import {
  AppVisibility,
  BluetoothAvailability,
  CapabilityMode,
  createLifecycleSnapshot,
  DesiredConnection,
  LifecyclePhase,
} from "../src-mobile/ble_lifecycle.js";
import {
  ConnectionAction,
  createConnectionOverviewPresentation,
} from "../src-mobile/connection_overview_model.js";

function snapshot(phase, overrides = {}) {
  const selectedDevice = overrides.selectedDevice ?? (
    [LifecyclePhase.READY, LifecyclePhase.CONNECTING, LifecyclePhase.DISCOVERING, LifecyclePhase.RECONNECTING].includes(phase)
      ? { id: "private-address", name: "Corne" }
      : null
  );
  const visibility = phase === LifecyclePhase.SUSPENDED
    ? AppVisibility.BACKGROUND
    : AppVisibility.FOREGROUND;
  return createLifecycleSnapshot({
    phase,
    visibility,
    permission: PermissionState.GRANTED,
    bluetoothAvailability: BluetoothAvailability.AVAILABLE,
    selectedDevice,
    desiredConnection: selectedDevice ? DesiredConnection.CONNECTED : DesiredConnection.NONE,
    capabilityMode: phase === LifecyclePhase.READY ? CapabilityMode.STOCK : CapabilityMode.UNKNOWN,
    ...overrides,
  });
}

test("every lifecycle phase maps to an immutable product presentation", () => {
  for (const phase of Object.values(LifecyclePhase)) {
    const presentation = createConnectionOverviewPresentation(snapshot(phase));
    assert.equal(presentation.phase, phase);
    assert.ok(presentation.title);
    assert.ok(presentation.detail);
    assert.ok(Object.isFrozen(presentation));
    assert.ok(Object.isFrozen(presentation.actions));
  }
  assert.throws(() => createConnectionOverviewPresentation({ phase: "imaginary" }), TypeError);
});

test("actions are derived only from legal lifecycle facts", () => {
  const initial = createConnectionOverviewPresentation(snapshot(LifecyclePhase.IDLE));
  assert.equal(initial.actions[ConnectionAction.FIND].enabled, true);
  assert.equal(initial.actions[ConnectionAction.CONNECT].visible, false);

  const scanning = createConnectionOverviewPresentation(snapshot(LifecyclePhase.SCANNING, {
    selectedDevice: { id: "private-address", name: "Corne" },
    desiredConnection: DesiredConnection.NONE,
    devices: [{ id: "private-address", name: "Corne", rssi: -48 }],
  }));
  assert.equal(scanning.actions[ConnectionAction.STOP_SCAN].enabled, true);
  assert.equal(scanning.actions[ConnectionAction.CONNECT].enabled, true);
  assert.equal(scanning.devices[0].selected, true);

  const exhausted = createConnectionOverviewPresentation(snapshot(LifecyclePhase.DISCONNECTED, {
    selectedDevice: { id: "private-address", name: "Corne" },
    desiredConnection: DesiredConnection.CONNECTED,
    reason: { code: "reconnect-exhausted", recoverable: true },
    retry: { attempt: 3, limit: 3 },
  }));
  assert.equal(exhausted.actions[ConnectionAction.RECONNECT].enabled, true);
  assert.equal(exhausted.actions[ConnectionAction.DISCONNECT].enabled, true);
  assert.match(exhausted.detail, /exhausted/i);

  const explicitlyDisconnected = createConnectionOverviewPresentation(snapshot(LifecyclePhase.DISCONNECTED, {
    selectedDevice: { id: "private-address", name: "Corne" },
    desiredConnection: DesiredConnection.NONE,
    reason: null,
  }));
  assert.equal(explicitlyDisconnected.actions[ConnectionAction.RECONNECT].visible, false);
  assert.equal(explicitlyDisconnected.actions[ConnectionAction.CONNECT].enabled, true);
  assert.equal(explicitlyDisconnected.actions[ConnectionAction.FIND_AGAIN].enabled, true);
});

test("permanent denial and Bluetooth loss never offer a prompt or scan loop", () => {
  const denied = createConnectionOverviewPresentation(snapshot(LifecyclePhase.PERMISSION_REQUIRED, {
    permission: PermissionState.PERMANENTLY_DENIED,
    bluetoothAvailability: BluetoothAvailability.AVAILABLE,
    reason: { code: "permission-denied", recoverable: true },
  }));
  assert.equal(denied.actions[ConnectionAction.FIND].enabled, false);
  assert.match(denied.detail, /Android app settings/);

  const unavailable = createConnectionOverviewPresentation(snapshot(LifecyclePhase.BLUETOOTH_UNAVAILABLE, {
    bluetoothAvailability: BluetoothAvailability.UNAVAILABLE,
    reason: { code: "bluetooth-unavailable", recoverable: true },
  }));
  assert.equal(Object.values(unavailable.actions).some(({ enabled }) => enabled), false);
  assert.match(unavailable.detail, /Turn Bluetooth on/);
});

test("stock and enhanced readiness share one base overview", () => {
  const stock = createConnectionOverviewPresentation(snapshot(LifecyclePhase.READY, {
    capabilityMode: CapabilityMode.STOCK,
  }));
  const enhanced = createConnectionOverviewPresentation(snapshot(LifecyclePhase.READY, {
    capabilityMode: CapabilityMode.ENHANCED,
  }));
  assert.equal(stock.title, enhanced.title);
  assert.equal(stock.detail, enhanced.detail);
  assert.equal(stock.capabilityLabel, "Stock");
  assert.equal(enhanced.capabilityLabel, "Enhanced");
  assert.equal(JSON.stringify(enhanced).includes("private-address"), false);
});

test("repeated snapshots produce deterministic presentation", () => {
  const current = snapshot(LifecyclePhase.RECONNECTING, {
    retry: { attempt: 2, limit: 3 },
    reason: { code: "connection-lost", recoverable: true },
  });
  assert.deepEqual(
    createConnectionOverviewPresentation(current),
    createConnectionOverviewPresentation(current),
  );
});
