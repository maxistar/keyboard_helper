import { PermissionState } from "./ble_transport.js";
import {
  AppVisibility,
  BluetoothAvailability,
  canExplicitReconnect,
  CapabilityMode,
  DesiredConnection,
  LifecyclePhase,
} from "./ble_lifecycle.js";

export const ConnectionAction = Object.freeze({
  FIND: "find",
  FIND_AGAIN: "find-again",
  STOP_SCAN: "stop-scan",
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  RECONNECT: "reconnect",
});

const STATUS_BY_PHASE = Object.freeze({
  [LifecyclePhase.IDLE]: ["Ready to find a keyboard", "Start a nearby scan when your keyboard is advertising.", "neutral"],
  [LifecyclePhase.PERMISSION_REQUIRED]: ["Bluetooth access needed", "Nearby devices access is used only after you choose to find a keyboard.", "attention"],
  [LifecyclePhase.SCANNING]: ["Looking for keyboards", "Keep the keyboard nearby and in pairing mode.", "progress"],
  [LifecyclePhase.CONNECTING]: ["Connecting", "Opening a secure Bluetooth connection.", "progress"],
  [LifecyclePhase.DISCOVERING]: ["Preparing keyboard", "Checking the services available on this keyboard.", "progress"],
  [LifecyclePhase.READY]: ["Keyboard connected", "The connection overview is ready.", "success"],
  [LifecyclePhase.RECONNECTING]: ["Reconnecting", "Trying a bounded foreground reconnect.", "progress"],
  [LifecyclePhase.SUSPENDED]: ["Connection paused", "Return to the app to continue.", "neutral"],
  [LifecyclePhase.DISCONNECTED]: ["Keyboard disconnected", "Reconnect the selected keyboard or find another one.", "attention"],
  [LifecyclePhase.BLUETOOTH_UNAVAILABLE]: ["Bluetooth is off", "Turn Bluetooth on, then return here. Scanning will not start automatically.", "attention"],
  [LifecyclePhase.UNSUPPORTED]: ["Bluetooth unavailable", "This device does not expose the required Bluetooth connection support.", "error"],
  [LifecyclePhase.CAPACITY_UNAVAILABLE]: ["Bluetooth is busy", "Close another Bluetooth session, then disconnect or try again.", "error"],
  [LifecyclePhase.FAILED]: ["Could not connect", "Use the available recovery action when the keyboard is nearby.", "error"],
});

const REASON_COPY = Object.freeze({
  "permission-required": "Nearby devices access is required before scanning.",
  "permission-denied": "Nearby devices access was denied. Grant it from Android app settings.",
  "bluetooth-unavailable": "Turn Bluetooth on before trying again.",
  "capacity-unavailable": "Android has no available Bluetooth connection capacity.",
  "reconnect-exhausted": "Automatic reconnect attempts are exhausted. Reconnect explicitly when ready.",
  "security-required": "Complete the Android pairing request, then reconnect.",
  "connection-failed": "The keyboard did not accept the connection. Move closer and try again.",
  "connection-lost": "The keyboard connection was lost.",
  "discovery-failed": "The keyboard connected, but its services could not be prepared.",
  "scan-failed": "The nearby keyboard scan could not be completed.",
  unsupported: "Bluetooth connection support is unavailable on this device.",
});

function freezeAction(visible, enabled, label) {
  return Object.freeze({ visible: Boolean(visible), enabled: Boolean(enabled), label });
}

function safeDeviceSummary(device) {
  return device ? Object.freeze({ name: String(device.name || "Unnamed device") }) : null;
}

export function createConnectionOverviewPresentation(snapshot) {
  if (!snapshot || !Object.values(LifecyclePhase).includes(snapshot.phase)) {
    throw new TypeError("A valid BLE lifecycle snapshot is required.");
  }
  const [defaultTitle, defaultDetail, defaultSeverity] = STATUS_BY_PHASE[snapshot.phase];
  const foreground = snapshot.visibility === AppVisibility.FOREGROUND;
  const available = snapshot.bluetoothSupported !== false &&
    snapshot.bluetoothAvailability === BluetoothAvailability.AVAILABLE;
  const permissionGranted = snapshot.permission === PermissionState.GRANTED;
  const permanentlyDenied = snapshot.permission === PermissionState.PERMANENTLY_DENIED;
  const noIntent = snapshot.desiredConnection === DesiredConnection.NONE;
  const initialFindPhase = [LifecyclePhase.IDLE, LifecyclePhase.PERMISSION_REQUIRED].includes(snapshot.phase);
  const repeatFindPhase = [LifecyclePhase.DISCONNECTED, LifecyclePhase.FAILED].includes(snapshot.phase);
  const canFind = foreground && !snapshot.systemInteractionLease && !permanentlyDenied &&
    snapshot.bluetoothSupported !== false && snapshot.bluetoothAvailability !== BluetoothAvailability.UNAVAILABLE &&
    noIntent;
  const canConnect = foreground && available && permissionGranted && Boolean(snapshot.selectedDevice) &&
    [LifecyclePhase.SCANNING, LifecyclePhase.IDLE, LifecyclePhase.DISCONNECTED, LifecyclePhase.FAILED].includes(snapshot.phase);
  const disconnectVisible = snapshot.desiredConnection === DesiredConnection.CONNECTED;
  const reasonDetail = snapshot.reason?.code ? REASON_COPY[snapshot.reason.code] : null;
  const permissionDetail = permanentlyDenied
    ? "Nearby devices access is blocked. Grant it from Android app settings."
    : null;
  const capabilityLabel = snapshot.phase === LifecyclePhase.READY
    ? snapshot.capabilityMode === CapabilityMode.ENHANCED ? "Enhanced" : "Stock"
    : "Not determined";

  const devices = Object.freeze((snapshot.devices ?? []).map((device, selectionIndex) => Object.freeze({
    name: String(device.name || "Unnamed device"),
    rssi: Number.isFinite(device.rssi) ? Number(device.rssi) : null,
    selected: device.id === snapshot.selectedDevice?.id,
    selectionIndex,
  })));
  const canReconnect = snapshot.desiredConnection === DesiredConnection.CONNECTED &&
    canExplicitReconnect(snapshot);

  return Object.freeze({
    phase: snapshot.phase,
    title: defaultTitle,
    detail: permissionDetail ?? reasonDetail ?? defaultDetail,
    severity: snapshot.reason && !["permission-required", "connection-lost", "reconnect-exhausted"].includes(snapshot.reason.code)
      ? "error"
      : defaultSeverity,
    busy: [LifecyclePhase.SCANNING, LifecyclePhase.CONNECTING, LifecyclePhase.DISCOVERING, LifecyclePhase.RECONNECTING].includes(snapshot.phase) || Boolean(snapshot.systemInteractionLease),
    selectedDevice: safeDeviceSummary(snapshot.selectedDevice),
    devices,
    capabilityLabel,
    retryLabel: snapshot.phase === LifecyclePhase.RECONNECTING
      ? `Attempt ${snapshot.retry.attempt} of ${snapshot.retry.limit}`
      : null,
    actions: Object.freeze({
      [ConnectionAction.FIND]: freezeAction(initialFindPhase, canFind && initialFindPhase, "Find keyboard"),
      [ConnectionAction.FIND_AGAIN]: freezeAction(repeatFindPhase && noIntent, canFind && repeatFindPhase, "Find another keyboard"),
      [ConnectionAction.STOP_SCAN]: freezeAction(snapshot.phase === LifecyclePhase.SCANNING, snapshot.phase === LifecyclePhase.SCANNING, "Stop scan"),
      [ConnectionAction.CONNECT]: freezeAction(Boolean(snapshot.selectedDevice) && noIntent, canConnect, "Connect"),
      [ConnectionAction.DISCONNECT]: freezeAction(disconnectVisible, disconnectVisible, "Disconnect"),
      [ConnectionAction.RECONNECT]: freezeAction(canReconnect, canReconnect, "Reconnect"),
    }),
  });
}
