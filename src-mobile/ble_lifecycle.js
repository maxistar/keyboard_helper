import { BleTransportError, PermissionState } from "./ble_transport.js";

export const LifecyclePhase = Object.freeze({
  IDLE: "idle",
  PERMISSION_REQUIRED: "permission-required",
  SCANNING: "scanning",
  CONNECTING: "connecting",
  DISCOVERING: "discovering",
  READY: "ready",
  RECONNECTING: "reconnecting",
  SUSPENDED: "suspended",
  DISCONNECTED: "disconnected",
  BLUETOOTH_UNAVAILABLE: "bluetooth-unavailable",
  UNSUPPORTED: "unsupported",
  CAPACITY_UNAVAILABLE: "capacity-unavailable",
  FAILED: "failed",
});

export const AppVisibility = Object.freeze({ FOREGROUND: "foreground", BACKGROUND: "background" });
export const DesiredConnection = Object.freeze({ NONE: "none", CONNECTED: "connected" });
export const BluetoothAvailability = Object.freeze({
  UNKNOWN: "unknown",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
});
export const CapabilityMode = Object.freeze({ UNKNOWN: "unknown", STOCK: "stock", ENHANCED: "enhanced" });

export const LifecycleEvent = Object.freeze({
  PLATFORM_OBSERVED: "platform-observed",
  PERMISSION_REQUESTED: "permission-requested",
  PERMISSION_RESOLVED: "permission-resolved",
  SCAN_REQUESTED: "scan-requested",
  SCAN_DEVICES: "scan-devices",
  SCAN_STOPPED: "scan-stopped",
  DEVICE_SELECTED: "device-selected",
  CONNECT_REQUESTED: "connect-requested",
  CONNECT_SUCCEEDED: "connect-succeeded",
  DISCOVERY_SUCCEEDED: "discovery-succeeded",
  OPERATION_FAILED: "operation-failed",
  CONNECTION_LOST: "connection-lost",
  RETRY_DUE: "retry-due",
  DISCONNECT_REQUESTED: "disconnect-requested",
  CLEANUP_COMPLETE: "cleanup-complete",
  VISIBILITY_OBSERVED: "visibility-observed",
  BACKGROUND_CONFIRMED: "background-confirmed",
  LEASE_ACQUIRED: "lease-acquired",
  LEASE_RELEASED: "lease-released",
  LEASE_EXPIRED: "lease-expired",
});

export const LifecycleEffect = Object.freeze({
  REQUEST_PERMISSION: "request-permission",
  START_SCAN: "start-scan",
  STOP_SCAN: "stop-scan",
  CONNECT: "connect",
  DISCOVER: "discover",
  CLEANUP: "cleanup",
  SCHEDULE_RETRY: "schedule-retry",
  SCHEDULE_BACKGROUND: "schedule-background",
  SCHEDULE_LEASE_EXPIRY: "schedule-lease-expiry",
  CANCEL_RETRY: "cancel-retry",
  CANCEL_BACKGROUND: "cancel-background",
  CANCEL_LEASE_EXPIRY: "cancel-lease-expiry",
});

export const RECONNECT_DELAYS_MS = Object.freeze([500, 1500, 3000]);
export const BACKGROUND_DEBOUNCE_MS = 500;
export const SYSTEM_INTERACTION_LEASE_MS = 30_000;

export class LifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
  }
}

const TERMINAL_REASONS = new Set(["permission-denied", "permission-required", "bluetooth-unavailable", "unsupported", "capacity-unavailable"]);

function freezeReason(reason) {
  if (!reason) return null;
  return Object.freeze({
    code: String(reason.code ?? "failed"),
    message: String(reason.message ?? "BLE lifecycle operation failed."),
    recoverable: Boolean(reason.recoverable),
  });
}

function freezeDevice(device) {
  if (!device) return null;
  if (typeof device.id !== "string" || !device.id.trim()) {
    throw new LifecycleError("invalid-device", "A selected device requires a stable process-local id.");
  }
  return Object.freeze({ id: device.id.trim(), name: String(device.name || "Unnamed device") });
}

function freezeObservedDevice(device) {
  const selected = freezeDevice(device);
  return Object.freeze({
    ...selected,
    rssi: Number.isFinite(device.rssi) ? Number(device.rssi) : null,
    connected: Boolean(device.connected),
    bonded: Boolean(device.bonded),
    advertisedServices: Object.freeze([...(device.advertisedServices ?? [])].map(String)),
  });
}

function freezeSnapshot(value) {
  const snapshot = {
    phase: value.phase,
    visibility: value.visibility,
    desiredConnection: value.desiredConnection,
    permission: value.permission,
    bluetoothAvailability: value.bluetoothAvailability,
    bluetoothSupported: value.bluetoothSupported,
    selectedDevice: freezeDevice(value.selectedDevice),
    devices: Object.freeze([...(value.devices ?? [])].map(freezeObservedDevice)),
    generation: value.generation,
    transportGeneration: value.transportGeneration,
    capabilityMode: value.capabilityMode,
    retry: Object.freeze({ attempt: value.retry.attempt, limit: value.retry.limit }),
    reason: freezeReason(value.reason),
    systemInteractionLease: value.systemInteractionLease,
  };
  assertSnapshot(snapshot);
  return Object.freeze(snapshot);
}

export function createLifecycleSnapshot(overrides = {}) {
  return freezeSnapshot({
    phase: LifecyclePhase.IDLE,
    visibility: AppVisibility.FOREGROUND,
    desiredConnection: DesiredConnection.NONE,
    permission: PermissionState.UNKNOWN,
    bluetoothAvailability: BluetoothAvailability.UNKNOWN,
    bluetoothSupported: true,
    selectedDevice: null,
    devices: [],
    generation: 0,
    transportGeneration: 0,
    capabilityMode: CapabilityMode.UNKNOWN,
    retry: { attempt: 0, limit: RECONNECT_DELAYS_MS.length },
    reason: null,
    systemInteractionLease: false,
    ...overrides,
  });
}

function assertSnapshot(snapshot) {
  if (!Object.values(LifecyclePhase).includes(snapshot.phase)) throw new LifecycleError("invalid-snapshot", "Unknown lifecycle phase.");
  if (!Object.values(AppVisibility).includes(snapshot.visibility)) throw new LifecycleError("invalid-snapshot", "Unknown visibility.");
  if (!Object.values(DesiredConnection).includes(snapshot.desiredConnection)) throw new LifecycleError("invalid-snapshot", "Unknown desired connection.");
  if (!Object.values(PermissionState).includes(snapshot.permission)) throw new LifecycleError("invalid-snapshot", "Unknown permission state.");
  if (!Object.values(BluetoothAvailability).includes(snapshot.bluetoothAvailability)) throw new LifecycleError("invalid-snapshot", "Unknown Bluetooth availability.");
  if (!Object.values(CapabilityMode).includes(snapshot.capabilityMode)) throw new LifecycleError("invalid-snapshot", "Unknown capability mode.");
  if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0) throw new LifecycleError("invalid-snapshot", "Invalid lifecycle generation.");
  if (snapshot.retry.attempt < 0 || snapshot.retry.attempt > snapshot.retry.limit) throw new LifecycleError("invalid-snapshot", "Invalid retry budget.");
  if (snapshot.phase === LifecyclePhase.READY && !snapshot.selectedDevice) throw new LifecycleError("invalid-snapshot", "Ready requires a selected device.");
  if (snapshot.desiredConnection === DesiredConnection.CONNECTED && !snapshot.selectedDevice) throw new LifecycleError("invalid-snapshot", "Connection intent requires a selected device.");
  if (snapshot.phase === LifecyclePhase.SUSPENDED && snapshot.visibility !== AppVisibility.BACKGROUND) throw new LifecycleError("invalid-snapshot", "Suspended requires background visibility.");
}

function effect(type, snapshot, values = {}) {
  return Object.freeze({ type, generation: snapshot.generation, transportGeneration: snapshot.transportGeneration, ...values });
}

function result(snapshot, effects = []) {
  return Object.freeze({ snapshot: freezeSnapshot(snapshot), effects: Object.freeze(effects) });
}

function reject(event, snapshot) {
  throw new LifecycleError("invalid-event", `${event.type} is not valid while lifecycle phase is ${snapshot.phase}.`);
}

function actionablePlatformPhase(snapshot) {
  if (!snapshot.bluetoothSupported) return LifecyclePhase.UNSUPPORTED;
  if (snapshot.permission !== PermissionState.GRANTED) return LifecyclePhase.PERMISSION_REQUIRED;
  if (snapshot.bluetoothAvailability === BluetoothAvailability.UNAVAILABLE) return LifecyclePhase.BLUETOOTH_UNAVAILABLE;
  return LifecyclePhase.IDLE;
}

function retryEligible(snapshot) {
  return snapshot.visibility === AppVisibility.FOREGROUND &&
    snapshot.desiredConnection === DesiredConnection.CONNECTED &&
    snapshot.selectedDevice && snapshot.permission === PermissionState.GRANTED &&
    snapshot.bluetoothAvailability === BluetoothAvailability.AVAILABLE && snapshot.bluetoothSupported;
}

export function canExplicitReconnect(snapshot) {
  return Boolean(snapshot.selectedDevice) &&
    snapshot.visibility === AppVisibility.FOREGROUND &&
    snapshot.permission === PermissionState.GRANTED &&
    snapshot.bluetoothAvailability === BluetoothAvailability.AVAILABLE &&
    snapshot.bluetoothSupported &&
    [LifecyclePhase.DISCONNECTED, LifecyclePhase.FAILED].includes(snapshot.phase);
}

function scheduleNextRetry(snapshot, reason) {
  if (!retryEligible(snapshot)) return result({ ...snapshot, phase: actionablePlatformPhase(snapshot), reason });
  if (snapshot.retry.attempt >= snapshot.retry.limit) {
    return result({ ...snapshot, phase: LifecyclePhase.DISCONNECTED, reason: { code: "reconnect-exhausted", message: "Reconnect attempts exhausted.", recoverable: true } });
  }
  const attempt = snapshot.retry.attempt + 1;
  const next = { ...snapshot, phase: LifecyclePhase.RECONNECTING, retry: { ...snapshot.retry, attempt }, reason };
  return result(next, [effect(LifecycleEffect.SCHEDULE_RETRY, next, { attempt, delayMs: RECONNECT_DELAYS_MS[attempt - 1] })]);
}

export function reduceLifecycle(current, event) {
  const snapshot = createLifecycleSnapshot(current);
  if (!event || !Object.values(LifecycleEvent).includes(event.type)) throw new LifecycleError("invalid-event", "Unknown lifecycle event.");

  switch (event.type) {
    case LifecycleEvent.PLATFORM_OBSERVED: {
      const next = { ...snapshot, permission: event.permission ?? snapshot.permission, bluetoothAvailability: event.availability ?? snapshot.bluetoothAvailability, bluetoothSupported: event.supported ?? snapshot.bluetoothSupported };
      if (!next.bluetoothSupported || next.bluetoothAvailability === BluetoothAvailability.UNAVAILABLE || next.permission !== PermissionState.GRANTED) {
        next.phase = next.visibility === AppVisibility.BACKGROUND ? LifecyclePhase.SUSPENDED : actionablePlatformPhase(next);
        next.generation += 1;
        next.transportGeneration += 1;
        next.capabilityMode = CapabilityMode.UNKNOWN;
        next.retry = { ...next.retry, attempt: 0 };
        const reasonCode = !next.bluetoothSupported ? "unsupported" : next.permission !== PermissionState.GRANTED ? "permission-required" : "bluetooth-unavailable";
        next.reason = { code: reasonCode, message: event.message ?? reasonCode, recoverable: reasonCode !== "unsupported" };
        return result(next, [effect(LifecycleEffect.CANCEL_RETRY, next), effect(LifecycleEffect.CLEANUP, next)]);
      }
      if ([LifecyclePhase.IDLE, LifecyclePhase.PERMISSION_REQUIRED, LifecyclePhase.BLUETOOTH_UNAVAILABLE].includes(snapshot.phase)) {
        if (retryEligible(next)) {
          next.phase = LifecyclePhase.RECONNECTING;
          next.retry = { ...next.retry, attempt: 1 };
          next.generation += 1;
          next.transportGeneration += 1;
          next.reason = null;
          return result(next, [effect(LifecycleEffect.SCHEDULE_RETRY, next, { attempt: 1, delayMs: RECONNECT_DELAYS_MS[0] })]);
        }
        next.phase = LifecyclePhase.IDLE;
        next.reason = null;
      }
      return result(next);
    }
    case LifecycleEvent.PERMISSION_REQUESTED: {
      if (snapshot.visibility !== AppVisibility.FOREGROUND) return reject(event, snapshot);
      const next = { ...snapshot, systemInteractionLease: true };
      return result(next, [effect(LifecycleEffect.SCHEDULE_LEASE_EXPIRY, next), effect(LifecycleEffect.REQUEST_PERMISSION, next)]);
    }
    case LifecycleEvent.PERMISSION_RESOLVED: {
      if (event.generation != null && event.generation !== snapshot.generation) return result(snapshot);
      const permission = event.permission;
      const next = { ...snapshot, permission };
      next.phase = permission === PermissionState.GRANTED ? actionablePlatformPhase(next) : LifecyclePhase.PERMISSION_REQUIRED;
      next.reason = permission === PermissionState.GRANTED ? null : { code: "permission-denied", message: "Bluetooth permission was not granted.", recoverable: true };
      return result(next);
    }
    case LifecycleEvent.SCAN_REQUESTED: {
      if (snapshot.visibility !== AppVisibility.FOREGROUND || snapshot.permission !== PermissionState.GRANTED || snapshot.bluetoothAvailability !== BluetoothAvailability.AVAILABLE || snapshot.desiredConnection !== DesiredConnection.NONE || ![LifecyclePhase.IDLE, LifecyclePhase.DISCONNECTED, LifecyclePhase.FAILED].includes(snapshot.phase)) return reject(event, snapshot);
      const next = { ...snapshot, phase: LifecyclePhase.SCANNING, devices: [], selectedDevice: null, reason: null };
      return result(next, [effect(LifecycleEffect.START_SCAN, next, { timeoutMs: event.timeoutMs })]);
    }
    case LifecycleEvent.SCAN_DEVICES:
      if (snapshot.phase !== LifecyclePhase.SCANNING) return reject(event, snapshot);
      return result({ ...snapshot, devices: Object.freeze([...(event.devices ?? [])]) });
    case LifecycleEvent.SCAN_STOPPED:
      if (snapshot.phase !== LifecyclePhase.SCANNING) return reject(event, snapshot);
      return result({ ...snapshot, phase: LifecyclePhase.IDLE }, event.native ? [] : [effect(LifecycleEffect.STOP_SCAN, snapshot)]);
    case LifecycleEvent.DEVICE_SELECTED:
      if (![LifecyclePhase.SCANNING, LifecyclePhase.IDLE, LifecyclePhase.DISCONNECTED].includes(snapshot.phase)) return reject(event, snapshot);
      return result({ ...snapshot, selectedDevice: event.device, reason: null });
    case LifecycleEvent.CONNECT_REQUESTED: {
      if (!snapshot.selectedDevice || snapshot.visibility !== AppVisibility.FOREGROUND || snapshot.permission !== PermissionState.GRANTED || snapshot.bluetoothAvailability !== BluetoothAvailability.AVAILABLE || ![LifecyclePhase.SCANNING, LifecyclePhase.IDLE, LifecyclePhase.DISCONNECTED, LifecyclePhase.FAILED].includes(snapshot.phase)) return reject(event, snapshot);
      const next = { ...snapshot, phase: LifecyclePhase.CONNECTING, desiredConnection: DesiredConnection.CONNECTED, generation: snapshot.generation + 1, transportGeneration: snapshot.transportGeneration + 1, capabilityMode: CapabilityMode.UNKNOWN, retry: { ...snapshot.retry, attempt: 0 }, reason: null };
      return result(next, [effect(LifecycleEffect.CONNECT, next, { deviceId: next.selectedDevice.id })]);
    }
    case LifecycleEvent.CONNECT_SUCCEEDED: {
      if (event.generation != null && event.generation !== snapshot.generation) return result(snapshot);
      if (![LifecyclePhase.CONNECTING, LifecyclePhase.RECONNECTING].includes(snapshot.phase)) return reject(event, snapshot);
      const next = { ...snapshot, phase: LifecyclePhase.DISCOVERING, transportGeneration: event.transportGeneration ?? snapshot.transportGeneration };
      return result(next, [effect(LifecycleEffect.DISCOVER, next)]);
    }
    case LifecycleEvent.DISCOVERY_SUCCEEDED:
      if (event.generation != null && event.generation !== snapshot.generation) return result(snapshot);
      if (snapshot.phase !== LifecyclePhase.DISCOVERING) return reject(event, snapshot);
      return result({ ...snapshot, phase: LifecyclePhase.READY, capabilityMode: event.capabilityMode, retry: { ...snapshot.retry, attempt: 0 }, reason: null });
    case LifecycleEvent.OPERATION_FAILED: {
      const reason = freezeReason(event.reason);
      if (event.generation != null && event.generation !== snapshot.generation) return result(snapshot);
      if (reason && TERMINAL_REASONS.has(reason.code)) {
        const facts = {
          ...snapshot,
          permission: reason.code.startsWith("permission") ? PermissionState.DENIED : snapshot.permission,
          bluetoothAvailability: reason.code === "bluetooth-unavailable" ? BluetoothAvailability.UNAVAILABLE : snapshot.bluetoothAvailability,
          bluetoothSupported: reason.code === "unsupported" ? false : snapshot.bluetoothSupported,
        };
        const terminal = reason.code === "capacity-unavailable" ? LifecyclePhase.CAPACITY_UNAVAILABLE : actionablePlatformPhase(facts);
        const next = { ...facts, phase: terminal, reason, retry: { ...snapshot.retry, attempt: 0 } };
        return result(next, [effect(LifecycleEffect.CANCEL_RETRY, next), effect(LifecycleEffect.CLEANUP, next)]);
      }
      if (snapshot.phase === LifecyclePhase.RECONNECTING) return scheduleNextRetry(snapshot, reason);
      return result({ ...snapshot, phase: LifecyclePhase.FAILED, reason });
    }
    case LifecycleEvent.CONNECTION_LOST: {
      if (event.transportGeneration != null && event.transportGeneration !== snapshot.transportGeneration) return result(snapshot);
      if (snapshot.desiredConnection !== DesiredConnection.CONNECTED || snapshot.phase === LifecyclePhase.SUSPENDED) return result(snapshot);
      const next = { ...snapshot, generation: snapshot.generation + 1, transportGeneration: snapshot.transportGeneration + 1, capabilityMode: CapabilityMode.UNKNOWN };
      return scheduleNextRetry(next, event.reason ?? { code: "connection-lost", message: "Bluetooth connection was lost.", recoverable: true });
    }
    case LifecycleEvent.RETRY_DUE: {
      if (snapshot.phase !== LifecyclePhase.RECONNECTING || event.attempt !== snapshot.retry.attempt || !retryEligible(snapshot)) return result(snapshot);
      const next = { ...snapshot, generation: snapshot.generation + 1, transportGeneration: snapshot.transportGeneration + 1 };
      return result(next, [effect(LifecycleEffect.CLEANUP, next), effect(LifecycleEffect.CONNECT, next, { deviceId: next.selectedDevice.id })]);
    }
    case LifecycleEvent.DISCONNECT_REQUESTED: {
      const next = { ...snapshot, desiredConnection: DesiredConnection.NONE, generation: snapshot.generation + 1, transportGeneration: snapshot.transportGeneration + 1, capabilityMode: CapabilityMode.UNKNOWN, retry: { ...snapshot.retry, attempt: 0 }, phase: LifecyclePhase.DISCONNECTED, reason: null };
      return result(next, [effect(LifecycleEffect.CANCEL_RETRY, next), effect(LifecycleEffect.CLEANUP, next)]);
    }
    case LifecycleEvent.CLEANUP_COMPLETE:
      return result(snapshot);
    case LifecycleEvent.VISIBILITY_OBSERVED: {
      if (event.visibility === snapshot.visibility) return result(snapshot);
      if (event.visibility === AppVisibility.BACKGROUND) {
        const next = { ...snapshot, visibility: AppVisibility.BACKGROUND };
        if (snapshot.systemInteractionLease) return result(next);
        return result(next, [effect(LifecycleEffect.SCHEDULE_BACKGROUND, next, { delayMs: BACKGROUND_DEBOUNCE_MS })]);
      }
      const next = { ...snapshot, visibility: AppVisibility.FOREGROUND, systemInteractionLease: false };
      const effects = [effect(LifecycleEffect.CANCEL_BACKGROUND, next), effect(LifecycleEffect.CANCEL_LEASE_EXPIRY, next)];
      if (snapshot.phase === LifecyclePhase.SUSPENDED && retryEligible(next)) {
        next.phase = LifecyclePhase.RECONNECTING;
        next.retry = { ...next.retry, attempt: 1 };
        next.generation += 1;
        next.transportGeneration += 1;
        effects.push(effect(LifecycleEffect.SCHEDULE_RETRY, next, { attempt: 1, delayMs: RECONNECT_DELAYS_MS[0] }));
      } else if (snapshot.phase === LifecyclePhase.SUSPENDED) {
        next.phase = actionablePlatformPhase(next);
      }
      return result(next, effects);
    }
    case LifecycleEvent.BACKGROUND_CONFIRMED: {
      if (snapshot.visibility !== AppVisibility.BACKGROUND || snapshot.systemInteractionLease) return result(snapshot);
      const next = { ...snapshot, phase: LifecyclePhase.SUSPENDED, generation: snapshot.generation + 1, transportGeneration: snapshot.transportGeneration + 1, capabilityMode: CapabilityMode.UNKNOWN, retry: { ...snapshot.retry, attempt: 0 }, devices: [] };
      return result(next, [effect(LifecycleEffect.CANCEL_RETRY, next), effect(LifecycleEffect.CLEANUP, next)]);
    }
    case LifecycleEvent.LEASE_ACQUIRED: {
      const next = { ...snapshot, systemInteractionLease: true };
      return result(next, [effect(LifecycleEffect.SCHEDULE_LEASE_EXPIRY, next)]);
    }
    case LifecycleEvent.LEASE_RELEASED: {
      if (event.generation != null && event.generation !== snapshot.generation) return result(snapshot);
      const next = { ...snapshot, systemInteractionLease: false };
      const effects = [effect(LifecycleEffect.CANCEL_LEASE_EXPIRY, next)];
      if (next.visibility === AppVisibility.BACKGROUND) effects.push(effect(LifecycleEffect.SCHEDULE_BACKGROUND, next, { delayMs: 0 }));
      return result(next, effects);
    }
    case LifecycleEvent.LEASE_EXPIRED: {
      if (!snapshot.systemInteractionLease) return result(snapshot);
      const next = { ...snapshot, systemInteractionLease: false };
      return next.visibility === AppVisibility.BACKGROUND ? reduceLifecycle(next, { type: LifecycleEvent.BACKGROUND_CONFIRMED }) : result(next);
    }
    default:
      return reject(event, snapshot);
  }
}

function normalizedReason(error, fallback = "failed") {
  const normalized = error instanceof BleTransportError ? error : new BleTransportError(fallback, error?.message ?? String(error), error);
  return Object.freeze({ code: normalized.code, message: normalized.message, recoverable: !TERMINAL_REASONS.has(normalized.code) });
}

export class BleLifecycleCoordinator {
  constructor(transport, options = {}) {
    if (!transport) throw new TypeError("BleLifecycleCoordinator requires a transport.");
    this.transport = transport;
    this.extensionServiceUuid = options.extensionServiceUuid;
    this.capabilitiesCharacteristicUuid = options.capabilitiesCharacteristicUuid;
    this.schedule = options.schedule ?? globalThis.setTimeout.bind(globalThis);
    this.cancelSchedule = options.cancelSchedule ?? globalThis.clearTimeout.bind(globalThis);
    this.state = createLifecycleSnapshot();
    this.listeners = new Set();
    this.generationListeners = new Set();
    this.queue = Promise.resolve();
    this.timers = { scan: null, retry: null, background: null, lease: null };
    this.services = [];
    this.capabilities = [];
    this.availabilityUnsubscribe = null;
    this.connectionUnsubscribe = this.transport.onConnectionLoss?.((event) => {
      void this.dispatch({ type: LifecycleEvent.CONNECTION_LOST, transportGeneration: this.state.transportGeneration, reason: normalizedReason(event, "connection-lost") });
    });
  }

  snapshot() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  onGenerationChange(listener) { this.generationListeners.add(listener); return () => this.generationListeners.delete(listener); }

  dispatch(event) {
    return this.enqueue(() => this.applyEvent(event));
  }

  enqueue(run) {
    const pending = this.queue.then(run, run);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async applyEvent(event) {
    const previousGeneration = this.state.generation;
    const transition = reduceLifecycle(this.state, event);
    this.state = transition.snapshot;
    if (previousGeneration !== this.state.generation) {
      this.services = [];
      this.capabilities = [];
      for (const listener of this.generationListeners) listener(this.state.generation);
    }
    for (const listener of this.listeners) listener(this.state);
    for (const nextEffect of transition.effects) await this.runEffect(nextEffect);
    return this.state;
  }

  async initialize() {
    const [permission, availability] = await Promise.all([
      this.transport.checkPermission(),
      this.transport.checkBluetoothAvailability?.() ?? { state: BluetoothAvailability.AVAILABLE, supported: true },
    ]);
    await this.dispatch({ type: LifecycleEvent.PLATFORM_OBSERVED, permission, availability: availability.state ?? availability, supported: availability.supported ?? true });
    this.availabilityUnsubscribe = await this.transport.observeBluetoothAvailability?.((value) => {
      void this.dispatch({ type: LifecycleEvent.PLATFORM_OBSERVED, availability: value.state ?? value, supported: value.supported ?? true });
    });
    return this.state;
  }

  async requestPermission() {
    const started = await this.dispatch({ type: LifecycleEvent.PERMISSION_REQUESTED });
    const generation = started.generation;
    return this.waitFor((snapshot) => snapshot.generation !== generation || !snapshot.systemInteractionLease);
  }
  startScan(timeoutMs = 10_000) { return this.dispatch({ type: LifecycleEvent.SCAN_REQUESTED, timeoutMs }); }
  stopScan() { return this.dispatch({ type: LifecycleEvent.SCAN_STOPPED }); }
  selectDevice(device) { return this.dispatch({ type: LifecycleEvent.DEVICE_SELECTED, device }); }
  async connectSelected() {
    await this.dispatch({ type: LifecycleEvent.CONNECT_REQUESTED });
    return this.waitFor((snapshot) => ![
      LifecyclePhase.CONNECTING,
      LifecyclePhase.DISCOVERING,
      LifecyclePhase.RECONNECTING,
    ].includes(snapshot.phase));
  }
  disconnect() { return this.dispatch({ type: LifecycleEvent.DISCONNECT_REQUESTED }); }
  setVisibility(visibility) { return this.dispatch({ type: LifecycleEvent.VISIBILITY_OBSERVED, visibility }); }

  async read(serviceUuid, characteristicUuid) {
    if (this.state.phase !== LifecyclePhase.READY) throw new LifecycleError("invalid-event", "Read requires a ready lifecycle.");
    const generation = this.state.generation;
    const bytes = await this.transport.read(serviceUuid, characteristicUuid);
    if (generation !== this.state.generation) throw new LifecycleError("stale-operation", "Read completed for an inactive generation.");
    return bytes;
  }

  async subscribeNotifications(serviceUuid, characteristicUuid, handler) {
    if (this.state.phase !== LifecyclePhase.READY || this.state.capabilityMode !== CapabilityMode.ENHANCED) throw new LifecycleError("invalid-event", "Notifications require a ready enhanced keyboard.");
    await this.dispatch({ type: LifecycleEvent.LEASE_ACQUIRED });
    const generation = this.state.generation;
    try {
      return await this.transport.subscribe(serviceUuid, characteristicUuid, (event) => {
        if (generation === this.state.generation) handler?.(event);
      });
    } finally {
      void this.dispatch({ type: LifecycleEvent.LEASE_RELEASED, generation });
    }
  }

  async runEffect(nextEffect) {
    if (nextEffect.generation !== this.state.generation && ![LifecycleEffect.CANCEL_RETRY, LifecycleEffect.CANCEL_BACKGROUND, LifecycleEffect.CANCEL_LEASE_EXPIRY, LifecycleEffect.CLEANUP].includes(nextEffect.type)) return;
    switch (nextEffect.type) {
      case LifecycleEffect.REQUEST_PERMISSION: {
        void this.runPermissionEffect(nextEffect);
        break;
      }
      case LifecycleEffect.START_SCAN:
        void this.runScanEffect(nextEffect);
        break;
      case LifecycleEffect.STOP_SCAN:
        this.clearTimer("scan");
        await this.transport.stopScan();
        break;
      case LifecycleEffect.CONNECT:
        this.clearTimer("scan");
        void this.runConnectEffect(nextEffect);
        break;
      case LifecycleEffect.DISCOVER:
        void this.runDiscoveryEffect(nextEffect);
        break;
      case LifecycleEffect.CLEANUP:
        this.clearTimer("scan");
        try { await this.transport.stopScan(); } catch (_error) { /* cleanup is best effort */ }
        try { await this.transport.disconnect(); } catch (error) { if (error?.code !== "disconnected" && error?.code !== "invalid-state") throw error; }
        break;
      case LifecycleEffect.SCHEDULE_RETRY:
        this.clearTimer("retry");
        this.timers.retry = this.schedule(() => { this.timers.retry = null; void this.dispatch({ type: LifecycleEvent.RETRY_DUE, attempt: nextEffect.attempt }); }, nextEffect.delayMs);
        break;
      case LifecycleEffect.SCHEDULE_BACKGROUND:
        this.clearTimer("background");
        this.timers.background = this.schedule(() => { this.timers.background = null; void this.dispatch({ type: LifecycleEvent.BACKGROUND_CONFIRMED }); }, nextEffect.delayMs);
        break;
      case LifecycleEffect.SCHEDULE_LEASE_EXPIRY:
        this.clearTimer("lease");
        this.timers.lease = this.schedule(() => { this.timers.lease = null; void this.dispatch({ type: LifecycleEvent.LEASE_EXPIRED }); }, SYSTEM_INTERACTION_LEASE_MS);
        break;
      case LifecycleEffect.CANCEL_RETRY: this.clearTimer("retry"); break;
      case LifecycleEffect.CANCEL_BACKGROUND: this.clearTimer("background"); break;
      case LifecycleEffect.CANCEL_LEASE_EXPIRY: this.clearTimer("lease"); break;
    }
  }

  clearTimer(name) {
    if (this.timers[name] !== null) this.cancelSchedule(this.timers[name]);
    this.timers[name] = null;
  }

  waitFor(predicate) {
    if (predicate(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe((snapshot) => {
        if (!predicate(snapshot)) return;
        unsubscribe();
        resolve(snapshot);
      });
    });
  }

  async runPermissionEffect(nextEffect) {
    let permission;
    try { permission = await this.transport.checkPermission({ request: true }); }
    catch (_error) { permission = PermissionState.DENIED; }
    await this.dispatch({ type: LifecycleEvent.PERMISSION_RESOLVED, permission, generation: nextEffect.generation });
    if (permission === PermissionState.GRANTED && nextEffect.generation === this.state.generation) {
      try {
        const availability = await this.transport.checkBluetoothAvailability();
        await this.dispatch({ type: LifecycleEvent.PLATFORM_OBSERVED, availability: availability.state ?? availability, supported: availability.supported ?? true });
      } catch (error) {
        await this.dispatch({ type: LifecycleEvent.OPERATION_FAILED, generation: nextEffect.generation, reason: normalizedReason(error, "bluetooth-unavailable") });
      }
    }
    await this.dispatch({ type: LifecycleEvent.LEASE_RELEASED, generation: nextEffect.generation });
  }

  async runScanEffect(nextEffect) {
    try {
      await this.transport.startScan({ timeoutMs: nextEffect.timeoutMs, onDevices: (devices) => void this.dispatch({ type: LifecycleEvent.SCAN_DEVICES, devices }).catch(() => {}) });
      if (nextEffect.generation !== this.state.generation || this.state.phase !== LifecyclePhase.SCANNING) return;
      this.clearTimer("scan");
      this.timers.scan = this.schedule(() => {
        this.timers.scan = null;
        void this.dispatch({ type: LifecycleEvent.SCAN_STOPPED }).catch(() => {});
      }, nextEffect.timeoutMs);
    } catch (error) {
      await this.dispatch({ type: LifecycleEvent.OPERATION_FAILED, generation: nextEffect.generation, reason: normalizedReason(error, "scan-failed") });
    }
  }

  async runConnectEffect(nextEffect) {
    try {
      await this.transport.connect(nextEffect.deviceId);
      await this.dispatch({ type: LifecycleEvent.CONNECT_SUCCEEDED, generation: nextEffect.generation, transportGeneration: this.transport.snapshot().connectionAttempt });
    } catch (error) {
      await this.dispatch({ type: LifecycleEvent.OPERATION_FAILED, generation: nextEffect.generation, reason: normalizedReason(error, "connection-failed") });
    }
  }

  async runDiscoveryEffect(nextEffect) {
    try {
      const services = await this.transport.discoverServices();
      const enhanced = this.extensionServiceUuid && services.some(({ uuid }) => uuid === this.extensionServiceUuid);
      let capabilities = [];
      if (enhanced && this.capabilitiesCharacteristicUuid) {
        capabilities = await this.transport.read(this.extensionServiceUuid, this.capabilitiesCharacteristicUuid);
      }
      if (nextEffect.generation === this.state.generation) {
        this.services = services;
        this.capabilities = capabilities;
      }
      await this.dispatch({ type: LifecycleEvent.DISCOVERY_SUCCEEDED, generation: nextEffect.generation, capabilityMode: enhanced ? CapabilityMode.ENHANCED : CapabilityMode.STOCK });
    } catch (error) {
      await this.dispatch({ type: LifecycleEvent.OPERATION_FAILED, generation: nextEffect.generation, reason: normalizedReason(error, "discovery-failed") });
    }
  }

  async dispose() {
    for (const name of Object.keys(this.timers)) this.clearTimer(name);
    this.availabilityUnsubscribe?.();
    this.connectionUnsubscribe?.();
    await this.transport.stopScan().catch(() => {});
    await this.transport.disconnect().catch(() => {});
    this.listeners.clear();
    this.generationListeners.clear();
  }
}
