export const PermissionState = Object.freeze({
  UNKNOWN: "unknown",
  PROMPT: "prompt",
  GRANTED: "granted",
  DENIED: "denied",
  PERMANENTLY_DENIED: "permanently-denied",
});

export const ConnectionState = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTING: "disconnecting",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
});

export class BleTransportError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "BleTransportError";
    this.code = code;
  }
}

export function normalizeTransportError(error, fallbackCode = "failed") {
  if (error instanceof BleTransportError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  let code = fallbackCode;
  const explicitCode = normalized.match(/^([a-z][a-z0-9-]+):/)?.[1];
  if (explicitCode) code = explicitCode;
  if (/permission-required/.test(normalized)) code = "permission-required";
  else if (/permission|denied|not allowed/.test(normalized)) code = "permission-denied";
  else if (/capacity-unavailable|insufficient resources|status (17|143)\b/.test(normalized)) code = "capacity-unavailable";
  else if (/unsupported|not supported|no bluetooth adapter/.test(normalized)) code = "unsupported";
  else if (/adapter-unavailable|bluetooth.{0,20}(disabled|unavailable|off)/.test(normalized)) code = "bluetooth-unavailable";
  else if (/encrypt|auth|bond|pair|security/.test(normalized)) code = "security-required";
  else if (/timeout|timed out/.test(normalized)) code = "timeout";
  else if (/disconnect|not connected/.test(normalized)) code = "disconnected";
  return new BleTransportError(code, message, error);
}

export function normalizeUuid(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BleTransportError("invalid-uuid", "A non-empty characteristic UUID is required.");
  }
  const uuid = value.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(uuid)) return `0000${uuid}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(uuid)) return `${uuid}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return uuid;
  }
  throw new BleTransportError("invalid-uuid", `Invalid Bluetooth UUID: ${value}`);
}

export function normalizeBytes(value) {
  if (value instanceof Uint8Array) return [...value];
  if (!Array.isArray(value) || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new BleTransportError("invalid-value", "BLE values must be byte arrays.");
  }
  return [...value];
}

export function normalizeDevice(value) {
  if (!value || typeof value.address !== "string" || value.address.trim() === "") {
    throw new BleTransportError("invalid-device", "A discovered device must have an address.");
  }
  return Object.freeze({
    id: value.address.trim(),
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Unnamed device",
    rssi: Number.isFinite(value.rssi) ? Number(value.rssi) : null,
    connected: Boolean(value.isConnected),
    bonded: Boolean(value.isBonded),
    advertisedServices: Array.isArray(value.services)
      ? [...new Set(value.services.map(normalizeUuid))]
      : [],
  });
}

function normalizeService(service) {
  return Object.freeze({
    uuid: normalizeUuid(service.uuid),
    characteristics: Array.isArray(service.characteristics)
      ? service.characteristics.map((characteristic) =>
          Object.freeze({
            uuid: normalizeUuid(characteristic.uuid),
            descriptors: Array.isArray(characteristic.descriptors)
              ? characteristic.descriptors.map(normalizeUuid)
              : [],
            properties: Number.isInteger(characteristic.properties)
              ? characteristic.properties
              : 0,
          }),
        )
      : [],
  });
}

export class AndroidBleTransport {
  constructor(adapter, options = {}) {
    if (!adapter) throw new TypeError("AndroidBleTransport requires an adapter.");
    this.adapter = adapter;
    this.defaultScanTimeoutMs = options.scanTimeoutMs ?? 10_000;
    this.schedule = options.schedule ?? globalThis.setTimeout.bind(globalThis);
    this.cancelSchedule = options.cancelSchedule ?? globalThis.clearTimeout.bind(globalThis);
    this.permission = PermissionState.UNKNOWN;
    this.scanning = false;
    this.devices = new Map();
    this.connection = ConnectionState.IDLE;
    this.connectionAttempt = 0;
    this.connectedDeviceId = null;
    this.lastDeviceId = null;
    this.scanTimer = null;
    this.subscription = null;
    this.connectionLossListeners = new Set();
  }

  snapshot() {
    return Object.freeze({
      permission: this.permission,
      scanning: this.scanning,
      devices: [...this.devices.values()],
      connection: this.connection,
      connectionAttempt: this.connectionAttempt,
      connectedDeviceId: this.connectedDeviceId,
    });
  }

  async checkPermission({ request = false } = {}) {
    try {
      const result = await this.adapter.checkPermissions(request);
      if (typeof result === "string" && Object.values(PermissionState).includes(result)) {
        this.permission = result;
      } else if (result === true) {
        this.permission = PermissionState.GRANTED;
      } else if (request && this.permission === PermissionState.DENIED) {
        this.permission = PermissionState.PERMANENTLY_DENIED;
      } else {
        this.permission = PermissionState.DENIED;
      }
      return this.permission;
    } catch (error) {
      throw normalizeTransportError(error, "permission-failed");
    }
  }

  async startScan({ timeoutMs = this.defaultScanTimeoutMs, onDevices } = {}) {
    if (this.permission !== PermissionState.GRANTED) {
      throw new BleTransportError("permission-required", "Bluetooth permission is required before scanning.");
    }
    if (this.scanning || [ConnectionState.CONNECTING, ConnectionState.CONNECTED].includes(this.connection)) {
      throw new BleTransportError("invalid-state", "Scanning is not available in the current state.");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new BleTransportError("invalid-timeout", "Scan timeout must be a positive number.");
    }

    this.devices.clear();
    this.scanning = true;
    this.scanTimer = this.schedule(() => void this.stopScan(), timeoutMs);
    try {
      await this.adapter.startScan((values) => {
        for (const value of Array.isArray(values) ? values : [values]) {
          const device = normalizeDevice(value);
          this.devices.set(device.id, device);
        }
        onDevices?.([...this.devices.values()]);
      }, timeoutMs);
      return this.snapshot();
    } catch (error) {
      this.finishScan();
      throw normalizeTransportError(error, "scan-failed");
    }
  }

  finishScan() {
    if (this.scanTimer !== null) this.cancelSchedule(this.scanTimer);
    this.scanTimer = null;
    this.scanning = false;
  }

  async stopScan() {
    if (!this.scanning) return this.snapshot();
    this.finishScan();
    try {
      await this.adapter.stopScan();
      return this.snapshot();
    } catch (error) {
      throw normalizeTransportError(error, "scan-stop-failed");
    }
  }

  async connect(deviceId) {
    if (this.scanning) await this.stopScan();
    if ([ConnectionState.CONNECTING, ConnectionState.CONNECTED, ConnectionState.DISCONNECTING].includes(this.connection)) {
      throw new BleTransportError("invalid-state", "Another connection operation is active.");
    }
    if (typeof deviceId !== "string" || deviceId.trim() === "") {
      throw new BleTransportError("invalid-device", "A device identifier is required.");
    }

    const id = deviceId.trim();
    const attempt = ++this.connectionAttempt;
    this.connection = ConnectionState.CONNECTING;
    try {
      await this.adapter.connect(id, (event) => this.handleDisconnect(attempt, event));
      if (attempt !== this.connectionAttempt) {
        throw new BleTransportError("stale-operation", "Connection completed for an inactive attempt.");
      }
      this.connection = ConnectionState.CONNECTED;
      this.connectedDeviceId = id;
      this.lastDeviceId = id;
      return this.snapshot();
    } catch (error) {
      if (attempt === this.connectionAttempt) {
        this.connection = ConnectionState.FAILED;
        this.connectedDeviceId = null;
      }
      throw normalizeTransportError(error, "connection-failed");
    }
  }

  handleDisconnect(attempt, event = {}) {
    if (attempt !== this.connectionAttempt) return false;
    this.subscription = null;
    this.connectedDeviceId = null;
    this.connection = ConnectionState.DISCONNECTED;
    const loss = Object.freeze({
      code: event.code ?? "connection-lost",
      message: event.message ?? `Bluetooth connection was lost${Number.isInteger(event.status) ? ` (status ${event.status})` : ""}.`,
      status: Number.isInteger(event.status) ? event.status : null,
      attempt,
      explicit: false,
    });
    for (const listener of this.connectionLossListeners) listener(loss);
    return true;
  }

  onConnectionLoss(listener) {
    this.connectionLossListeners.add(listener);
    return () => this.connectionLossListeners.delete(listener);
  }

  async checkBluetoothAvailability() {
    try {
      return await this.adapter.checkBluetoothAvailability();
    } catch (error) {
      throw normalizeTransportError(error, "bluetooth-unavailable");
    }
  }

  async observeBluetoothAvailability(listener) {
    return this.adapter.observeBluetoothAvailability(listener);
  }

  requireConnection() {
    if (this.connection !== ConnectionState.CONNECTED || !this.connectedDeviceId) {
      throw new BleTransportError("invalid-state", "A connected device is required.");
    }
    return { id: this.connectedDeviceId, attempt: this.connectionAttempt };
  }

  async discoverServices() {
    const { id, attempt } = this.requireConnection();
    try {
      const services = await this.adapter.listServices(id);
      if (attempt !== this.connectionAttempt) {
        throw new BleTransportError("stale-operation", "Discovery completed for an inactive attempt.");
      }
      return Array.isArray(services) ? services.map(normalizeService) : [];
    } catch (error) {
      throw normalizeTransportError(error, "discovery-failed");
    }
  }

  async read(serviceUuid, characteristicUuid) {
    const { attempt } = this.requireConnection();
    try {
      const value = await this.adapter.read(normalizeUuid(characteristicUuid), normalizeUuid(serviceUuid));
      if (attempt !== this.connectionAttempt) {
        throw new BleTransportError("stale-operation", "Read completed for an inactive attempt.");
      }
      return normalizeBytes(value);
    } catch (error) {
      throw normalizeTransportError(error, "read-failed");
    }
  }

  async subscribe(serviceUuid, characteristicUuid, onNotification) {
    const { attempt } = this.requireConnection();
    const service = normalizeUuid(serviceUuid);
    const characteristic = normalizeUuid(characteristicUuid);
    if (this.subscription) {
      throw new BleTransportError("invalid-state", "A notification subscription is already active.");
    }
    try {
      await this.adapter.subscribe(characteristic, service, (value) => {
        if (attempt !== this.connectionAttempt) return;
        onNotification?.(Object.freeze({
          attempt,
          serviceUuid: service,
          characteristicUuid: characteristic,
          bytes: normalizeBytes(value),
        }));
      });
      if (attempt !== this.connectionAttempt) {
        throw new BleTransportError("stale-operation", "Subscription completed for an inactive attempt.");
      }
      this.subscription = { service, characteristic, attempt };
      return Object.freeze({ ...this.subscription });
    } catch (error) {
      throw normalizeTransportError(error, "subscription-failed");
    }
  }

  async disconnect() {
    if (this.connection === ConnectionState.DISCONNECTING) {
      throw new BleTransportError("invalid-state", "Disconnect is already in progress.");
    }
    const subscription = this.subscription;
    this.connection = ConnectionState.DISCONNECTING;
    ++this.connectionAttempt;
    this.subscription = null;
    try {
      if (subscription) {
        await this.adapter.unsubscribe(subscription.characteristic, subscription.service);
      }
      await this.adapter.disconnect();
      this.connectedDeviceId = null;
      this.connection = ConnectionState.DISCONNECTED;
      return this.snapshot();
    } catch (error) {
      this.connectedDeviceId = null;
      this.connection = ConnectionState.FAILED;
      throw normalizeTransportError(error, "disconnect-failed");
    }
  }

  async reconnect() {
    if (!this.lastDeviceId) {
      throw new BleTransportError("invalid-state", "There is no previous device to reconnect.");
    }
    return this.connect(this.lastDeviceId);
  }
}
