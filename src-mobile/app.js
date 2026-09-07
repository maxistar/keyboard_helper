import {
  AndroidBleTransport,
  ConnectionState,
  PermissionState,
  normalizeUuid,
} from "./ble_transport.js";
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
    "permission",
    "connection",
    "diagnostic",
    "devices",
    "services",
    "battery",
    "capabilities",
    "notification",
    "request-permission",
    "start-scan",
    "stop-scan",
    "connect",
    "discover",
    "subscribe",
    "disconnect",
    "reconnect",
  ].map((id) => [id, document.getElementById(id)]),
);

let transport;
let selectedDeviceId = null;
let lastServices = [];

function hex(bytes, limit = 20) {
  return bytes
    .slice(0, limit)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function setDiagnostic(message, level = "info") {
  elements.diagnostic.textContent = message;
  elements.diagnostic.dataset.level = level;
}

function render() {
  const snapshot = transport.snapshot();
  elements.permission.textContent = snapshot.permission;
  elements.connection.textContent = snapshot.connection;
  elements["stop-scan"].disabled = !snapshot.scanning;
  elements["start-scan"].disabled = snapshot.scanning || snapshot.connection === ConnectionState.CONNECTED;
  elements.connect.disabled = !selectedDeviceId || snapshot.connection === ConnectionState.CONNECTED;
  elements.discover.disabled = snapshot.connection !== ConnectionState.CONNECTED;
  elements.subscribe.disabled =
    snapshot.connection !== ConnectionState.CONNECTED ||
    !lastServices.some(({ uuid }) => uuid === UUIDS.extensionService);
  elements.disconnect.disabled = snapshot.connection !== ConnectionState.CONNECTED;
  elements.reconnect.disabled = snapshot.connection !== ConnectionState.DISCONNECTED;
}

function renderDevices(devices) {
  elements.devices.replaceChildren();
  if (devices.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No devices observed yet";
    elements.devices.append(item);
    return;
  }
  for (const device of devices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "device";
    button.dataset.selected = String(device.id === selectedDeviceId);
    button.textContent = `${device.name} · ${device.id} · ${device.rssi ?? "?"} dBm`;
    button.addEventListener("click", () => {
      selectedDeviceId = device.id;
      renderDevices(devices);
      render();
    });
    const item = document.createElement("li");
    item.append(button);
    elements.devices.append(item);
  }
}

async function action(label, operation) {
  setDiagnostic(`${label}…`);
  try {
    await operation();
    setDiagnostic(`${label}: complete`, "success");
  } catch (error) {
    const code = error?.code ? `${error.code}: ` : "";
    setDiagnostic(`${code}${error?.message ?? String(error)}`, "error");
  } finally {
    render();
  }
}

async function ensurePermission() {
  let state = await transport.checkPermission();
  if (state !== PermissionState.GRANTED) {
    state = await transport.checkPermission({ request: true });
  }
  if (state !== PermissionState.GRANTED) {
    throw new Error(
      state === PermissionState.PERMANENTLY_DENIED
        ? "Bluetooth permission is blocked. Open Android app settings to grant Nearby devices."
        : "Bluetooth permission was denied.",
    );
  }
}

elements["request-permission"].addEventListener("click", () =>
  action("Bluetooth permission", async () => {
    await transport.checkPermission({ request: true });
  }),
);

elements["start-scan"].addEventListener("click", () =>
  action("Bounded scan", async () => {
    await ensurePermission();
    selectedDeviceId = null;
    renderDevices([]);
    await transport.startScan({ timeoutMs: 10_000, onDevices: renderDevices });
  }),
);

elements["stop-scan"].addEventListener("click", () =>
  action("Stop scan", () => transport.stopScan()),
);

elements.connect.addEventListener("click", () =>
  action("Connect", async () => {
    await transport.connect(selectedDeviceId);
    lastServices = [];
  }),
);

elements.discover.addEventListener("click", () =>
  action("GATT discovery", async () => {
    lastServices = await transport.discoverServices();
    elements.services.textContent = lastServices.map(({ uuid }) => uuid).join("\n") || "No services";

    if (lastServices.some(({ uuid }) => uuid === UUIDS.batteryService)) {
      const value = await transport.read(UUIDS.batteryService, UUIDS.batteryLevel);
      elements.battery.textContent = value.length ? `${value[0]}%` : "Empty value";
    } else {
      elements.battery.textContent = "Unavailable";
    }

    if (lastServices.some(({ uuid }) => uuid === UUIDS.extensionService)) {
      const value = await transport.read(UUIDS.extensionService, UUIDS.capabilities);
      elements.capabilities.textContent = `${value.length} bytes · ${hex(value)}`;
    } else {
      elements.capabilities.textContent = "Stock keyboard / extension unavailable";
    }
  }),
);

elements.subscribe.addEventListener("click", () =>
  action("Event subscription", () =>
    transport.subscribe(UUIDS.extensionService, UUIDS.events, (event) => {
      elements.notification.textContent =
        `${event.characteristicUuid}\n${event.bytes.length} bytes · ${hex(event.bytes)}`;
      setDiagnostic("Real keyboard notification observed", "success");
    }),
  ),
);

elements.disconnect.addEventListener("click", () =>
  action("Disconnect", async () => {
    await transport.disconnect();
    lastServices = [];
  }),
);

elements.reconnect.addEventListener("click", () =>
  action("Explicit reconnect", async () => {
    await transport.reconnect();
    lastServices = [];
  }),
);

try {
  transport = new AndroidBleTransport(new NativeBleAdapter());
  transport.checkPermission().then(render).catch((error) => setDiagnostic(error.message, "error"));
  renderDevices([]);
  render();
} catch (error) {
  setDiagnostic(error.message, "error");
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
}
