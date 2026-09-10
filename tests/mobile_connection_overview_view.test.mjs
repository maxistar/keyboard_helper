import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PermissionState } from "../src-mobile/ble_transport.js";
import {
  BluetoothAvailability,
  CapabilityMode,
  createLifecycleSnapshot,
  DesiredConnection,
  LifecyclePhase,
} from "../src-mobile/ble_lifecycle.js";
import {
  createConnectionEvidenceSnapshot,
  DEVICE_INFORMATION_FIELDS,
  EvidenceStatus,
  EvidenceValueStatus,
} from "../src-mobile/connection_evidence.js";
import { createMobileConnectionOverviewView } from "../src-mobile/connection_overview.js";
import { MobileLayoutViewerModel } from "../src-mobile/layout_viewer_model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class ElementStub {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = "";
    this.type = "";
  }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  async dispatch(type) { await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target: this }))); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

class FakeSource {
  constructor(state) {
    this.state = state;
    this.listeners = new Set();
  }
  snapshot() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  publish(state) { this.state = state; for (const listener of this.listeners) listener(state); }
}

class FakeCoordinator extends FakeSource {
  constructor(state) { super(state); this.calls = []; }
  async requestPermission() {
    this.calls.push("request-permission");
    this.publish(createLifecycleSnapshot({
      ...this.state,
      phase: LifecyclePhase.IDLE,
      permission: PermissionState.GRANTED,
      bluetoothAvailability: BluetoothAvailability.AVAILABLE,
      reason: null,
    }));
  }
  async startScan() { this.calls.push("start-scan"); }
  async stopScan() { this.calls.push("stop-scan"); }
  async selectDevice(device) { this.calls.push(["select", device.id]); }
  async connectSelected() { this.calls.push("connect"); }
  async disconnect() { this.calls.push("disconnect"); }
}

class FakeEvidence extends FakeSource {}

function harness(snapshot = createLifecycleSnapshot({
  phase: LifecyclePhase.PERMISSION_REQUIRED,
  permission: PermissionState.PROMPT,
  bluetoothAvailability: BluetoothAvailability.AVAILABLE,
})) {
  const ids = [
    "connection-overview", "connection-status", "connection-status-title", "connection-status-detail",
    "connection-device-name", "connection-capability", "connection-retry", "connection-live",
    "connection-devices", "connection-device-empty", "connection-evidence-status", "connection-battery",
    ...Object.values({ find: "find", findAgain: "find-again", stop: "stop-scan", connect: "connect", disconnect: "disconnect", reconnect: "reconnect" })
      .map((action) => `connection-action-${action}`),
    ...DEVICE_INFORMATION_FIELDS.map(({ key }) => `connection-${key}`),
  ];
  const elements = new Map(ids.map((id) => [id, new ElementStub(id.includes("action") ? "button" : "div")]));
  const document = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tagName) => new ElementStub(tagName),
  };
  const coordinator = new FakeCoordinator(snapshot);
  const evidence = new FakeEvidence(createConnectionEvidenceSnapshot(snapshot.generation));
  const view = createMobileConnectionOverviewView(document, coordinator, evidence);
  return { document, elements, coordinator, evidence, view };
}

test("product view renders lifecycle state and runs just-in-time discovery", async () => {
  const subject = harness();
  assert.match(subject.elements.get("connection-status-title").textContent, /access needed/i);
  const find = subject.elements.get("connection-action-find");
  assert.equal(find.hidden, false);
  assert.equal(find.disabled, false);
  await find.dispatch("click");
  assert.deepEqual(subject.coordinator.calls, ["request-permission", "start-scan"]);
  assert.equal(subject.elements.get("connection-live").dataset.level, "success");
});

test("device selection never presents the process-local identifier", async () => {
  const subject = harness(createLifecycleSnapshot({
    phase: LifecyclePhase.SCANNING,
    permission: PermissionState.GRANTED,
    bluetoothAvailability: BluetoothAvailability.AVAILABLE,
    devices: [{ id: "AA:PRIVATE", name: "Corne", rssi: -51 }],
  }));
  const item = subject.elements.get("connection-devices").children[0];
  const button = item.children[0];
  assert.match(button.textContent, /Corne.*-51 dBm/);
  assert.equal(button.textContent.includes("AA:PRIVATE"), false);
  await button.dispatch("click");
  assert.deepEqual(subject.coordinator.calls, [["select", "AA:PRIVATE"]]);
});

test("ready stock and enhanced modes retain the same stable action nodes", () => {
  const stock = createLifecycleSnapshot({
    phase: LifecyclePhase.READY,
    permission: PermissionState.GRANTED,
    bluetoothAvailability: BluetoothAvailability.AVAILABLE,
    desiredConnection: DesiredConnection.CONNECTED,
    selectedDevice: { id: "private", name: "Corne" },
    capabilityMode: CapabilityMode.STOCK,
  });
  const subject = harness(stock);
  const disconnect = subject.elements.get("connection-action-disconnect");
  assert.equal(subject.elements.get("connection-capability").textContent, "Stock");
  subject.coordinator.publish(createLifecycleSnapshot({ ...stock, capabilityMode: CapabilityMode.ENHANCED }));
  assert.equal(subject.elements.get("connection-capability").textContent, "Enhanced");
  assert.equal(subject.elements.get("connection-action-disconnect"), disconnect);
  assert.equal(disconnect.hidden, false);
});

test("partial evidence renders independently without moving lifecycle or viewer state", () => {
  const subject = harness();
  const viewer = new MobileLayoutViewerModel();
  viewer.selectLayout("corne");
  viewer.selectLayer(2);
  const before = viewer.snapshot();
  const fields = Object.fromEntries(DEVICE_INFORMATION_FIELDS.map(({ key }) => [
    key,
    Object.freeze({
      status: key === "model" ? EvidenceValueStatus.AVAILABLE : EvidenceValueStatus.ABSENT,
      value: key === "model" ? "Corne" : null,
      diagnostic: null,
    }),
  ]));
  subject.evidence.publish(Object.freeze({
    generation: 4,
    status: EvidenceStatus.PARTIAL,
    battery: Object.freeze({ status: EvidenceValueStatus.FAILED, value: null, diagnostic: "Battery failed." }),
    deviceInformation: Object.freeze(fields),
  }));
  assert.equal(subject.elements.get("connection-battery").textContent, "Could not read");
  assert.equal(subject.elements.get("connection-model").textContent, "Corne");
  assert.match(subject.elements.get("connection-evidence-status").textContent, /Some/);
  assert.equal(viewer.snapshot(), before);
});

test("every connection transition leaves viewer selection independent", () => {
  const subject = harness();
  const viewer = new MobileLayoutViewerModel();
  viewer.selectLayout("dactyl");
  viewer.selectLayer(2);
  const before = viewer.snapshot();
  const selectedDevice = { id: "private", name: "Dactyl" };
  for (const phase of Object.values(LifecyclePhase)) {
    subject.coordinator.publish(createLifecycleSnapshot({
      phase,
      visibility: phase === LifecyclePhase.SUSPENDED ? "background" : "foreground",
      permission: PermissionState.GRANTED,
      bluetoothAvailability: BluetoothAvailability.AVAILABLE,
      selectedDevice: [LifecyclePhase.READY, LifecyclePhase.CONNECTING, LifecyclePhase.DISCOVERING, LifecyclePhase.RECONNECTING].includes(phase)
        ? selectedDevice
        : null,
      desiredConnection: [LifecyclePhase.READY, LifecyclePhase.CONNECTING, LifecyclePhase.DISCOVERING, LifecyclePhase.RECONNECTING].includes(phase)
        ? DesiredConnection.CONNECTED
        : DesiredConnection.NONE,
      capabilityMode: phase === LifecyclePhase.READY ? CapabilityMode.ENHANCED : CapabilityMode.UNKNOWN,
    }));
    assert.equal(viewer.snapshot(), before, phase);
  }
});

test("mobile overview source stays within the read-only foreground product boundary", async () => {
  const [html, css, app, view, model, evidence] = await Promise.all([
    readFile(path.join(root, "src-mobile/index.html"), "utf8"),
    readFile(path.join(root, "src-mobile/styles.css"), "utf8"),
    readFile(path.join(root, "src-mobile/app.js"), "utf8"),
    readFile(path.join(root, "src-mobile/connection_overview.js"), "utf8"),
    readFile(path.join(root, "src-mobile/connection_overview_model.js"), "utf8"),
    readFile(path.join(root, "src-mobile/connection_evidence.js"), "utf8"),
  ]);
  assert.match(html, /data-surface="mobile-connection-overview"/);
  assert.match(html, /aria-label="Keyboard connection actions"/);
  assert.match(html, /role="status" aria-live="polite" aria-busy="false"/);
  assert.doesNotMatch(html, /Discover and read|Subscribe to events|Latest notification|raw payload/i);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(css, /safe-area-inset/);
  assert.match(css, /overflow-x:\s*hidden/);
  const source = `${app}\n${view}\n${model}\n${evidence}`;
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|WebSocket|EventSource|fetch\(|XMLHttpRequest|subscribeNotifications|write\(|setInterval|foreground service/i);
  assert.doesNotMatch(app, /main\.js|menu|overlay|global.listener|input.source|settings/i);
});
