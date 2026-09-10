import { PermissionState } from "./ble_transport.js";
import { BluetoothAvailability, LifecyclePhase } from "./ble_lifecycle.js";
import {
  ConnectionAction,
  createConnectionOverviewPresentation,
} from "./connection_overview_model.js";
import {
  DEVICE_INFORMATION_FIELDS,
  EvidenceStatus,
  EvidenceValueStatus,
} from "./connection_evidence.js";

function required(document, id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Mobile connection overview is missing #${id}.`);
  return element;
}

function valueText(value, suffix = "") {
  if (value.status === EvidenceValueStatus.AVAILABLE) return `${value.value}${suffix}`;
  if (value.status === EvidenceValueStatus.LOADING) return "Loading…";
  if (value.status === EvidenceValueStatus.MALFORMED) return "Invalid value";
  if (value.status === EvidenceValueStatus.FAILED) return "Could not read";
  return "Not available";
}

function evidenceSummary(status) {
  const values = {
    [EvidenceStatus.IDLE]: "Keyboard details appear after a connection is ready.",
    [EvidenceStatus.LOADING]: "Reading available keyboard details…",
    [EvidenceStatus.AVAILABLE]: "All supported keyboard details are available.",
    [EvidenceStatus.PARTIAL]: "Some keyboard details are available.",
    [EvidenceStatus.UNAVAILABLE]: "This keyboard does not provide standard details.",
  };
  return values[status] ?? values[EvidenceStatus.IDLE];
}

export function createMobileConnectionOverviewView(document, coordinator, evidenceController) {
  const elements = {
    card: required(document, "connection-overview"),
    status: required(document, "connection-status"),
    title: required(document, "connection-status-title"),
    detail: required(document, "connection-status-detail"),
    selectedDevice: required(document, "connection-device-name"),
    capability: required(document, "connection-capability"),
    retry: required(document, "connection-retry"),
    localStatus: required(document, "connection-live"),
    devices: required(document, "connection-devices"),
    deviceEmpty: required(document, "connection-device-empty"),
    evidenceStatus: required(document, "connection-evidence-status"),
    battery: required(document, "connection-battery"),
    actions: Object.fromEntries(Object.values(ConnectionAction).map((action) => [
      action,
      required(document, `connection-action-${action}`),
    ])),
    fields: Object.fromEntries(DEVICE_INFORMATION_FIELDS.map(({ key }) => [
      key,
      required(document, `connection-${key}`),
    ])),
  };
  let lastSnapshot = coordinator.snapshot();

  function report(message, level = "info") {
    elements.localStatus.textContent = message;
    elements.localStatus.dataset.level = level;
  }

  async function run(label, operation) {
    report(`${label}…`);
    try {
      const completed = await operation();
      report(
        completed === false ? `${label} needs your attention. Follow the connection guidance above.` : `${label} complete.`,
        completed === false ? "info" : "success",
      );
    } catch (_error) {
      report(`${label} could not be completed. Follow the connection guidance above.`, "error");
    }
  }

  async function findKeyboard() {
    if (coordinator.snapshot().permission !== PermissionState.GRANTED) {
      await coordinator.requestPermission();
    }
    const snapshot = coordinator.snapshot();
    if (snapshot.permission !== PermissionState.GRANTED) return false;
    if (snapshot.bluetoothAvailability !== BluetoothAvailability.AVAILABLE) return false;
    await coordinator.startScan(10_000);
    return true;
  }

  const handlers = {
    [ConnectionAction.FIND]: () => run("Find keyboard", findKeyboard),
    [ConnectionAction.FIND_AGAIN]: () => run("Find another keyboard", findKeyboard),
    [ConnectionAction.STOP_SCAN]: () => run("Stop scan", () => coordinator.stopScan()),
    [ConnectionAction.CONNECT]: () => run("Connect", () => coordinator.connectSelected()),
    [ConnectionAction.DISCONNECT]: () => run("Disconnect", () => coordinator.disconnect()),
    [ConnectionAction.RECONNECT]: () => run("Reconnect", () => coordinator.connectSelected()),
  };

  for (const [action, button] of Object.entries(elements.actions)) {
    button.addEventListener("click", handlers[action]);
  }

  function renderDevices(presentation) {
    const items = presentation.devices.map((device) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "connection-device";
      button.dataset.selected = String(device.selected);
      button.setAttribute("aria-pressed", String(device.selected));
      button.disabled = presentation.phase !== LifecyclePhase.SCANNING;
      const signal = device.rssi == null ? "Signal unavailable" : `Signal ${device.rssi} dBm`;
      button.textContent = `${device.name} · ${signal}`;
      button.addEventListener("click", () => void run(
        "Select keyboard",
        () => coordinator.selectDevice(lastSnapshot.devices[device.selectionIndex]),
      ));
      const item = document.createElement("li");
      item.append(button);
      return item;
    });
    elements.devices.replaceChildren(...items);
    elements.deviceEmpty.hidden = presentation.devices.length > 0;
    elements.deviceEmpty.textContent = presentation.phase === LifecyclePhase.SCANNING
      ? "No keyboards found yet. The scan stops automatically."
      : "No keyboard selected. Choose Find keyboard to scan again.";
  }

  function renderLifecycle(snapshot) {
    lastSnapshot = snapshot;
    const presentation = createConnectionOverviewPresentation(snapshot);
    elements.card.dataset.phase = presentation.phase;
    elements.status.dataset.severity = presentation.severity;
    elements.status.setAttribute("aria-busy", String(presentation.busy));
    elements.title.textContent = presentation.title;
    elements.detail.textContent = presentation.detail;
    elements.selectedDevice.textContent = presentation.selectedDevice?.name ?? "None selected";
    elements.capability.textContent = presentation.capabilityLabel;
    elements.retry.textContent = presentation.retryLabel ?? "Not active";
    elements.retry.hidden = presentation.retryLabel == null;
    for (const [action, button] of Object.entries(elements.actions)) {
      const state = presentation.actions[action];
      button.textContent = state.label;
      button.hidden = !state.visible;
      button.disabled = !state.enabled;
    }
    renderDevices(presentation);
  }

  function renderEvidence(snapshot) {
    elements.evidenceStatus.textContent = evidenceSummary(snapshot.status);
    elements.evidenceStatus.setAttribute("aria-busy", String(snapshot.status === EvidenceStatus.LOADING));
    elements.battery.textContent = valueText(snapshot.battery, "%");
    elements.battery.dataset.status = snapshot.battery.status;
    for (const field of DEVICE_INFORMATION_FIELDS) {
      const value = snapshot.deviceInformation[field.key];
      elements.fields[field.key].textContent = valueText(value);
      elements.fields[field.key].dataset.status = value.status;
    }
  }

  const unsubscribeLifecycle = coordinator.subscribe(renderLifecycle);
  const unsubscribeEvidence = evidenceController.subscribe(renderEvidence);
  return {
    reportError() { report("Connection support could not be initialized.", "error"); },
    renderLifecycle,
    renderEvidence,
    snapshot: () => lastSnapshot,
    dispose() {
      unsubscribeLifecycle();
      unsubscribeEvidence();
      for (const [action, button] of Object.entries(elements.actions)) {
        button.removeEventListener?.("click", handlers[action]);
      }
    },
  };
}
