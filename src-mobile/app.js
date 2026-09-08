import { AndroidBleTransport, PermissionState, normalizeUuid } from "./ble_transport.js";
import {
  AppVisibility,
  BleLifecycleCoordinator,
  BluetoothAvailability,
  canExplicitReconnect,
  CapabilityMode,
  DesiredConnection,
  LifecyclePhase,
} from "./ble_lifecycle.js";
import { NativeBleAdapter } from "./native_ble_adapter.js";

const UUIDS = Object.freeze({
  batteryService: normalizeUuid("180f"),
  batteryLevel: normalizeUuid("2a19"),
  extensionService: "b34a0001-e782-4706-8f9c-6c056c416507",
  capabilities: "b34a0003-e782-4706-8f9c-6c056c416507",
  events: "b34a0004-e782-4706-8f9c-6c056c416507",
});

const elements = Object.fromEntries(
  [
    "permission", "connection", "visibility", "intent", "bluetooth", "generation",
    "capability-mode", "retry", "reason", "diagnostic", "devices", "services",
    "battery", "capabilities", "notification", "request-permission", "start-scan",
    "stop-scan", "connect", "discover", "subscribe", "disconnect", "reconnect",
  ].map((id) => [id, document.getElementById(id)]),
);

let coordinator;

function hex(bytes, limit = 20) {
  return bytes.slice(0, limit).map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function setDiagnostic(message, level = "info") {
  elements.diagnostic.textContent = message;
  elements.diagnostic.dataset.level = level;
}

function reasonMessage(snapshot) {
  const messages = {
    "permission-required": "Grant Nearby devices permission to scan.",
    "permission-denied": "Bluetooth permission is blocked. Open Android app settings to grant Nearby devices.",
    "bluetooth-unavailable": "Turn Bluetooth on to continue. Recovery will not scan automatically.",
    "capacity-unavailable": "Android has no BLE connection capacity. Close other BLE sessions and retry.",
    "reconnect-exhausted": "Automatic reconnect exhausted. Use Reconnect when the device is available.",
    "security-required": "Android pairing or encryption is required; retry and complete the system prompt.",
    "discovery-failed": "GATT discovery failed. Disconnect and retry near the keyboard.",
    unsupported: "This Android device does not expose a usable BLE central adapter.",
  };
  return snapshot.reason ? (messages[snapshot.reason.code] ?? snapshot.reason.message) : "none";
}

function renderDevices(snapshot) {
  elements.devices.replaceChildren();
  if (snapshot.devices.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No devices observed yet";
    elements.devices.append(item);
    return;
  }
  for (const device of snapshot.devices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "device";
    button.dataset.selected = String(device.id === snapshot.selectedDevice?.id);
    button.disabled = snapshot.phase !== LifecyclePhase.SCANNING;
    button.textContent = `${device.name} · ${device.id} · ${device.rssi ?? "?"} dBm`;
    button.addEventListener("click", () => void action("Select device", () => coordinator.selectDevice(device)));
    const item = document.createElement("li");
    item.append(button);
    elements.devices.append(item);
  }
}

function render(snapshot = coordinator.snapshot()) {
  elements.permission.textContent = snapshot.permission;
  elements.connection.textContent = snapshot.phase;
  elements.visibility.textContent = snapshot.visibility;
  elements.intent.textContent = snapshot.desiredConnection;
  elements.bluetooth.textContent = snapshot.bluetoothAvailability;
  elements.generation.textContent = `${snapshot.generation} / transport ${snapshot.transportGeneration}`;
  elements["capability-mode"].textContent = snapshot.capabilityMode;
  elements.retry.textContent = `${snapshot.retry.attempt}/${snapshot.retry.limit}`;
  elements.reason.textContent = reasonMessage(snapshot);

  const foreground = snapshot.visibility === AppVisibility.FOREGROUND;
  const platformReady = foreground && snapshot.permission === PermissionState.GRANTED &&
    snapshot.bluetoothAvailability === BluetoothAvailability.AVAILABLE;
  elements["request-permission"].disabled = !foreground || snapshot.permission === PermissionState.GRANTED;
  elements["start-scan"].disabled = !platformReady || ![LifecyclePhase.IDLE, LifecyclePhase.DISCONNECTED, LifecyclePhase.FAILED].includes(snapshot.phase) || snapshot.desiredConnection !== DesiredConnection.NONE;
  elements["stop-scan"].disabled = snapshot.phase !== LifecyclePhase.SCANNING;
  elements.connect.disabled = !snapshot.selectedDevice || !platformReady || ![LifecyclePhase.SCANNING, LifecyclePhase.IDLE, LifecyclePhase.DISCONNECTED, LifecyclePhase.FAILED].includes(snapshot.phase);
  elements.discover.disabled = snapshot.phase !== LifecyclePhase.READY;
  elements.subscribe.disabled = snapshot.phase !== LifecyclePhase.READY || snapshot.capabilityMode !== CapabilityMode.ENHANCED;
  elements.disconnect.disabled = snapshot.desiredConnection !== DesiredConnection.CONNECTED;
  elements.reconnect.disabled = !canExplicitReconnect(snapshot);
  renderDevices(snapshot);
}

async function action(label, operation) {
  setDiagnostic(`${label}…`);
  try {
    await operation();
    const snapshot = coordinator.snapshot();
    setDiagnostic(snapshot.reason ? reasonMessage(snapshot) : `${label}: complete`, snapshot.reason ? "error" : "success");
  } catch (error) {
    const code = error?.code ? `${error.code}: ` : "";
    setDiagnostic(`${code}${error?.message ?? String(error)}`, "error");
  } finally {
    render();
  }
}

async function requestPermissionForUserAction() {
  if (coordinator.snapshot().permission !== PermissionState.GRANTED) await coordinator.requestPermission();
  if (coordinator.snapshot().permission !== PermissionState.GRANTED) throw new Error("Bluetooth permission was denied.");
}

async function readEvidence() {
  const services = coordinator.services;
  elements.services.textContent = services.map(({ uuid }) => uuid).join("\n") || "No services";
  if (services.some(({ uuid }) => uuid === UUIDS.batteryService)) {
    const value = await coordinator.read(UUIDS.batteryService, UUIDS.batteryLevel);
    elements.battery.textContent = value.length ? `${value[0]}%` : "Empty value";
  } else {
    elements.battery.textContent = "Unavailable";
  }
  if (coordinator.snapshot().capabilityMode === CapabilityMode.ENHANCED) {
    const value = coordinator.capabilities;
    elements.capabilities.textContent = `${value.length} bytes · ${hex(value)}`;
  } else {
    elements.capabilities.textContent = "Stock keyboard / extension unavailable";
  }
}

elements["request-permission"].addEventListener("click", () => action("Bluetooth permission", () => coordinator.requestPermission()));
elements["start-scan"].addEventListener("click", () => action("Bounded scan", async () => {
  await requestPermissionForUserAction();
  await coordinator.startScan(10_000);
}));
elements["stop-scan"].addEventListener("click", () => action("Stop scan", () => coordinator.stopScan()));
elements.connect.addEventListener("click", () => action("Connect and discover", async () => {
  await coordinator.connectSelected();
  await readEvidence();
}));
elements.discover.addEventListener("click", () => action("Read GATT evidence", readEvidence));
elements.subscribe.addEventListener("click", () => action("Event subscription", () =>
  coordinator.subscribeNotifications(UUIDS.extensionService, UUIDS.events, (event) => {
    elements.notification.textContent = `${event.characteristicUuid}\n${event.bytes.length} bytes · ${hex(event.bytes)}`;
    setDiagnostic("Real keyboard notification observed", "success");
  }),
));
elements.disconnect.addEventListener("click", () => action("Disconnect", () => coordinator.disconnect()));
elements.reconnect.addEventListener("click", () => action("Explicit reconnect", async () => {
  await coordinator.connectSelected();
  await readEvidence();
}));

try {
  coordinator = new BleLifecycleCoordinator(new AndroidBleTransport(new NativeBleAdapter()), {
    extensionServiceUuid: UUIDS.extensionService,
    capabilitiesCharacteristicUuid: UUIDS.capabilities,
  });
  coordinator.subscribe(render);
  coordinator.onGenerationChange(() => {
    elements.services.textContent = "Not discovered";
    elements.battery.textContent = "Not read";
    elements.capabilities.textContent = "Not read";
    elements.notification.textContent = "None";
  });
  document.addEventListener("visibilitychange", () => {
    const visibility = document.visibilityState === "hidden" ? AppVisibility.BACKGROUND : AppVisibility.FOREGROUND;
    void coordinator.setVisibility(visibility);
  });
  coordinator.initialize().catch((error) => setDiagnostic(error.message, "error"));
} catch (error) {
  setDiagnostic(error.message, "error");
  document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
}
