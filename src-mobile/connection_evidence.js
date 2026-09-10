import { normalizeUuid } from "./ble_transport.js";
import { LifecyclePhase } from "./ble_lifecycle.js";

export const EvidenceValueStatus = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  AVAILABLE: "available",
  ABSENT: "absent",
  MALFORMED: "malformed",
  FAILED: "failed",
  STALE: "stale",
});

export const EvidenceStatus = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  AVAILABLE: "available",
  PARTIAL: "partial",
  UNAVAILABLE: "unavailable",
});

export const STANDARD_SERVICE_UUIDS = Object.freeze({
  batteryService: normalizeUuid("180f"),
  batteryLevel: normalizeUuid("2a19"),
  deviceInformationService: normalizeUuid("180a"),
});

export const DEVICE_INFORMATION_FIELDS = Object.freeze([
  Object.freeze({ key: "manufacturer", label: "Manufacturer", characteristicUuid: normalizeUuid("2a29") }),
  Object.freeze({ key: "model", label: "Model", characteristicUuid: normalizeUuid("2a24") }),
  Object.freeze({ key: "firmware", label: "Firmware", characteristicUuid: normalizeUuid("2a26") }),
  Object.freeze({ key: "hardware", label: "Hardware", characteristicUuid: normalizeUuid("2a27") }),
  Object.freeze({ key: "software", label: "Software", characteristicUuid: normalizeUuid("2a28") }),
]);

export const STANDARD_TEXT_LIMIT = 80;
export const EVIDENCE_DIAGNOSTIC_LIMIT = 140;

function normalizeDisplayText(value) {
  return String(value)
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedDiagnostic(value) {
  const normalized = normalizeDisplayText(value ?? "Optional keyboard information is unavailable.");
  return normalized.length <= EVIDENCE_DIAGNOSTIC_LIMIT
    ? normalized
    : `${normalized.slice(0, EVIDENCE_DIAGNOSTIC_LIMIT - 1)}…`;
}

function evidenceValue(status, value = null, diagnostic = null) {
  return Object.freeze({ status, value, diagnostic: diagnostic ? boundedDiagnostic(diagnostic) : null });
}

function createFields(status = EvidenceValueStatus.IDLE) {
  return Object.freeze(Object.fromEntries(DEVICE_INFORMATION_FIELDS.map(({ key }) => [key, evidenceValue(status)])));
}

function freezeSnapshot({ generation, status, battery, deviceInformation }) {
  return Object.freeze({
    generation,
    status,
    battery,
    deviceInformation: Object.freeze({ ...deviceInformation }),
  });
}

export function createConnectionEvidenceSnapshot(generation = 0, valueStatus = EvidenceValueStatus.IDLE) {
  const status = valueStatus === EvidenceValueStatus.LOADING ? EvidenceStatus.LOADING : EvidenceStatus.IDLE;
  return freezeSnapshot({
    generation,
    status,
    battery: evidenceValue(valueStatus),
    deviceInformation: createFields(valueStatus),
  });
}

export function decodeBatteryEvidence(bytes) {
  if (!Array.isArray(bytes) || bytes.length !== 1 || !Number.isInteger(bytes[0]) || bytes[0] < 0 || bytes[0] > 100) {
    return evidenceValue(EvidenceValueStatus.MALFORMED, null, "Battery Level returned an invalid value.");
  }
  return evidenceValue(EvidenceValueStatus.AVAILABLE, bytes[0]);
}

export function decodeTextEvidence(bytes, label = "Device information") {
  if (!Array.isArray(bytes) || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    return evidenceValue(EvidenceValueStatus.MALFORMED, null, `${label} returned an invalid value.`);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    const normalized = normalizeDisplayText(decoded);
    if (!normalized) return evidenceValue(EvidenceValueStatus.MALFORMED, null, `${label} returned an empty value.`);
    const value = normalized.length <= STANDARD_TEXT_LIMIT
      ? normalized
      : `${normalized.slice(0, STANDARD_TEXT_LIMIT - 1)}…`;
    return evidenceValue(EvidenceValueStatus.AVAILABLE, value);
  } catch (_error) {
    return evidenceValue(EvidenceValueStatus.MALFORMED, null, `${label} returned invalid text.`);
  }
}

function serviceHasCharacteristic(services, serviceUuid, characteristicUuid) {
  return services.some((service) => service.uuid === serviceUuid &&
    service.characteristics?.some((characteristic) => characteristic.uuid === characteristicUuid));
}

function overallStatus(battery, deviceInformation) {
  const values = [battery, ...Object.values(deviceInformation)];
  const available = values.filter(({ status }) => status === EvidenceValueStatus.AVAILABLE).length;
  if (available === values.length) return EvidenceStatus.AVAILABLE;
  if (available > 0) return EvidenceStatus.PARTIAL;
  return EvidenceStatus.UNAVAILABLE;
}

export class ConnectionEvidenceController {
  constructor(coordinator) {
    if (!coordinator?.snapshot || !coordinator?.subscribe || !coordinator?.read) {
      throw new TypeError("ConnectionEvidenceController requires a lifecycle coordinator.");
    }
    this.coordinator = coordinator;
    this.listeners = new Set();
    this.requestToken = 0;
    this.pending = Promise.resolve();
    this.state = createConnectionEvidenceSnapshot(coordinator.snapshot().generation);
    this.unsubscribeLifecycle = coordinator.subscribe((snapshot) => this.observeLifecycle(snapshot));
  }

  snapshot() { return this.state; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  publish(snapshot) {
    this.state = snapshot;
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  observeLifecycle(snapshot) {
    if (snapshot.phase !== LifecyclePhase.READY) {
      if (this.state.generation !== snapshot.generation || this.state.status !== EvidenceStatus.IDLE) {
        this.requestToken += 1;
        this.publish(createConnectionEvidenceSnapshot(snapshot.generation));
      }
      return;
    }
    if (this.state.generation === snapshot.generation && this.state.status !== EvidenceStatus.IDLE) return;
    this.pending = this.load(snapshot.generation);
  }

  async readOptional(serviceUuid, characteristicUuid, decoder, label) {
    if (!serviceHasCharacteristic(this.coordinator.services ?? [], serviceUuid, characteristicUuid)) {
      return evidenceValue(EvidenceValueStatus.ABSENT);
    }
    try {
      return decoder(await this.coordinator.read(serviceUuid, characteristicUuid), label);
    } catch (_error) {
      return evidenceValue(EvidenceValueStatus.FAILED, null, `${label} could not be read.`);
    }
  }

  async load(generation) {
    const token = ++this.requestToken;
    this.publish(createConnectionEvidenceSnapshot(generation, EvidenceValueStatus.LOADING));
    const stillActive = () => {
      const current = this.coordinator.snapshot();
      return token === this.requestToken && current.generation === generation && current.phase === LifecyclePhase.READY;
    };
    const battery = await this.readOptional(
      STANDARD_SERVICE_UUIDS.batteryService,
      STANDARD_SERVICE_UUIDS.batteryLevel,
      decodeBatteryEvidence,
      "Battery Level",
    );
    if (!stillActive()) return this.state;
    const fields = [];
    for (const field of DEVICE_INFORMATION_FIELDS) {
      const value = await this.readOptional(
        STANDARD_SERVICE_UUIDS.deviceInformationService,
        field.characteristicUuid,
        decodeTextEvidence,
        field.label,
      );
      if (!stillActive()) return this.state;
      fields.push([field.key, value]);
    }
    const deviceInformation = Object.freeze(Object.fromEntries(fields));
    return this.publish(freezeSnapshot({
      generation,
      status: overallStatus(battery, deviceInformation),
      battery,
      deviceInformation,
    }));
  }

  whenSettled() { return this.pending; }

  dispose() {
    this.requestToken += 1;
    this.unsubscribeLifecycle?.();
    this.listeners.clear();
  }
}
