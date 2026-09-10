import {
  BLE_KEYBOARD_EVENT_TYPES,
  BLE_KEYBOARD_FRAME_FLAGS,
  BLE_KEYBOARD_UUIDS,
  DECODER_OUTCOME,
  decodeBleKeyboardCapabilities,
  decodeBleKeyboardFrame,
} from "./shared-generated/ble_keyboard_decoder.js";
import { CapabilityMode, LifecyclePhase } from "./ble_lifecycle.js";

export const TelemetryStatus = Object.freeze({
  IDLE: "idle",
  UNAVAILABLE: "unavailable",
  SUBSCRIBING: "subscribing",
  AWAITING_STREAM_START: "awaiting-stream-start",
  LIVE: "live",
  FAILED: "failed",
  STALE: "stale",
});

export const COMBO_VISUAL_EXPIRY_MS = 800;
export const TELEMETRY_DIAGNOSTIC_LIMIT = 4;

const EVENT_FEATURES = Object.freeze({
  [BLE_KEYBOARD_EVENT_TYPES.key]: "keyEvents",
  [BLE_KEYBOARD_EVENT_TYPES.combo]: "comboEvents",
  [BLE_KEYBOARD_EVENT_TYPES.layer]: "layerEvents",
  [BLE_KEYBOARD_EVENT_TYPES.diagnostic]: "diagnostics",
});

const DIAGNOSTIC_COPY = Object.freeze({
  1: "The keyboard event queue dropped telemetry. Held indicators were cleared.",
});

function freezeSnapshot(value) {
  return Object.freeze({
    generation: value.generation,
    status: value.status,
    reason: value.reason ?? null,
    capabilities: value.capabilities ?? null,
    lastSequence: value.lastSequence ?? null,
    activeLayer: value.activeLayer ?? null,
    layerAuthoritative: Boolean(value.layerAuthoritative),
    pressedPositions: Object.freeze([...(value.pressedPositions ?? [])]),
    activeCombos: Object.freeze([...(value.activeCombos ?? [])].map((combo) => Object.freeze({
      ...combo,
      positions: Object.freeze([...combo.positions]),
    }))),
    diagnostics: Object.freeze([...(value.diagnostics ?? [])].map((diagnostic) => Object.freeze({ ...diagnostic }))),
  });
}

export function createTelemetrySnapshot(generation = 0, status = TelemetryStatus.IDLE, overrides = {}) {
  return freezeSnapshot({ generation, status, ...overrides });
}

function serviceHasEventCharacteristic(services) {
  return (services ?? []).some((service) => service.uuid === BLE_KEYBOARD_UUIDS.service
    && service.characteristics?.some((characteristic) => characteristic.uuid === BLE_KEYBOARD_UUIDS.events));
}

function supportsTelemetry(capabilities) {
  return Object.values(EVENT_FEATURES).some((feature) => capabilities.features[feature]);
}

function boundedIssue(code, values = {}) {
  return Object.freeze({ code, ...values });
}

export class MobileTelemetryController {
  constructor(coordinator, options = {}) {
    if (!coordinator?.snapshot || !coordinator?.subscribe || !coordinator?.subscribeNotifications) {
      throw new TypeError("MobileTelemetryController requires a lifecycle coordinator.");
    }
    this.coordinator = coordinator;
    this.schedule = options.schedule ?? globalThis.setTimeout.bind(globalThis);
    this.cancelSchedule = options.cancelSchedule ?? globalThis.clearTimeout.bind(globalThis);
    this.comboExpiryMs = options.comboExpiryMs ?? COMBO_VISUAL_EXPIRY_MS;
    this.listeners = new Set();
    this.token = 0;
    this.activeGeneration = null;
    this.capabilities = null;
    this.pressed = new Set();
    this.combos = new Map();
    this.comboTimers = new Map();
    this.diagnostics = [];
    this.pending = Promise.resolve();
    this.disposed = false;
    this.state = createTelemetrySnapshot(coordinator.snapshot().generation);
    this.unsubscribeLifecycle = coordinator.subscribe((snapshot) => this.observeLifecycle(snapshot));
  }

  snapshot() { return this.state; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  publish(values) {
    if (this.disposed) return this.state;
    this.state = freezeSnapshot(values);
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  base(status, reason = null) {
    return {
      generation: this.activeGeneration ?? this.coordinator.snapshot().generation,
      status,
      reason,
      capabilities: this.capabilities,
      lastSequence: null,
      activeLayer: null,
      layerAuthoritative: false,
      pressedPositions: [],
      activeCombos: [],
      diagnostics: this.diagnostics,
    };
  }

  clearTransient() {
    this.pressed.clear();
    this.combos.clear();
    for (const timer of this.comboTimers.values()) this.cancelSchedule(timer);
    this.comboTimers.clear();
  }

  resetStream({ clearDiagnostics = true } = {}) {
    this.clearTransient();
    if (clearDiagnostics) this.diagnostics = [];
  }

  observeLifecycle(snapshot) {
    if (this.disposed) return;
    if (snapshot.phase !== LifecyclePhase.READY) {
      const wasOwned = this.activeGeneration !== null;
      this.token += 1;
      this.resetStream();
      this.capabilities = null;
      this.activeGeneration = null;
      this.publish(createTelemetrySnapshot(
        snapshot.generation,
        wasOwned ? TelemetryStatus.STALE : TelemetryStatus.IDLE,
        wasOwned ? { reason: boundedIssue("lifecycle-not-ready") } : {},
      ));
      return;
    }
    if (this.activeGeneration === snapshot.generation) return;

    const token = ++this.token;
    this.resetStream();
    this.capabilities = null;
    this.activeGeneration = snapshot.generation;
    if (snapshot.capabilityMode !== CapabilityMode.ENHANCED) {
      this.publish(this.base(TelemetryStatus.UNAVAILABLE, boundedIssue("stock-keyboard")));
      return;
    }
    if (!serviceHasEventCharacteristic(this.coordinator.services)) {
      this.publish(this.base(TelemetryStatus.UNAVAILABLE, boundedIssue("event-characteristic-unavailable")));
      return;
    }

    const capabilityResult = decodeBleKeyboardCapabilities(this.coordinator.capabilities);
    if (capabilityResult.status !== DECODER_OUTCOME.decoded) {
      this.publish(this.base(TelemetryStatus.UNAVAILABLE, boundedIssue(capabilityResult.issue.code)));
      return;
    }
    this.capabilities = capabilityResult.value;
    if (!supportsTelemetry(this.capabilities)) {
      this.publish(this.base(TelemetryStatus.UNAVAILABLE, boundedIssue("event-kinds-unavailable")));
      return;
    }

    this.publish(this.base(TelemetryStatus.SUBSCRIBING));
    this.pending = this.enroll(snapshot.generation, token);
  }

  owns(generation, token) {
    const lifecycle = this.coordinator.snapshot();
    return !this.disposed && token === this.token && generation === this.activeGeneration
      && lifecycle.generation === generation && lifecycle.phase === LifecyclePhase.READY;
  }

  async enroll(generation, token) {
    try {
      await this.coordinator.subscribeNotifications(
        BLE_KEYBOARD_UUIDS.service,
        BLE_KEYBOARD_UUIDS.events,
        (notification) => this.receive(notification?.bytes ?? notification, generation, token),
      );
      if (this.owns(generation, token) && this.state.status === TelemetryStatus.SUBSCRIBING) {
        this.publish({ ...this.base(TelemetryStatus.AWAITING_STREAM_START), diagnostics: this.diagnostics });
      }
    } catch (_error) {
      if (this.owns(generation, token)) {
        this.resetStream({ clearDiagnostics: false });
        this.publish(this.base(TelemetryStatus.FAILED, boundedIssue("subscription-failed")));
      }
    }
    return this.state;
  }

  whenSettled() { return this.pending; }

  addDiagnostic(issue) {
    this.diagnostics = [...this.diagnostics, Object.freeze(issue)].slice(-TELEMETRY_DIAGNOSTIC_LIMIT);
  }

  currentValues(overrides = {}) {
    return {
      generation: this.activeGeneration,
      status: this.state.status,
      reason: this.state.reason,
      capabilities: this.capabilities,
      lastSequence: this.state.lastSequence,
      activeLayer: this.state.activeLayer,
      layerAuthoritative: this.state.layerAuthoritative,
      pressedPositions: [...this.pressed].sort((left, right) => left - right),
      activeCombos: [...this.combos.values()].sort((left, right) => left.comboId - right.comboId),
      diagnostics: this.diagnostics,
      ...overrides,
    };
  }

  beginStream(event, envelope) {
    this.resetStream();
    const layerRequired = this.capabilities.features.layerEvents;
    const validLayerSnapshot = event.kind === "layer"
      && Boolean(envelope.flags & BLE_KEYBOARD_FRAME_FLAGS.snapshot);
    if (layerRequired && !validLayerSnapshot) {
      this.addDiagnostic(boundedIssue("invalid-stream-start"));
      this.publish(this.currentValues({
        status: TelemetryStatus.AWAITING_STREAM_START,
        lastSequence: null,
        activeLayer: null,
        layerAuthoritative: false,
      }));
      return false;
    }

    this.publish(this.currentValues({
      status: TelemetryStatus.LIVE,
      reason: null,
      lastSequence: envelope.sequence,
      activeLayer: validLayerSnapshot ? event.layer : null,
      layerAuthoritative: validLayerSnapshot,
    }));
    return true;
  }

  observeSequence(envelope) {
    const expected = (this.state.lastSequence + 1) >>> 0;
    if (envelope.sequence !== expected) {
      this.clearTransient();
      this.addDiagnostic(boundedIssue("sequence-gap", {
        expected,
        actual: envelope.sequence,
        distance: (envelope.sequence - expected) >>> 0,
      }));
    }
    this.state = freezeSnapshot(this.currentValues({ lastSequence: envelope.sequence }));
  }

  eventAdvertised(eventType) {
    const feature = EVENT_FEATURES[eventType];
    return Boolean(feature && this.capabilities.features[feature]);
  }

  receive(value, generation, token) {
    if (!this.owns(generation, token)) return;
    const outcome = decodeBleKeyboardFrame(value, this.capabilities);
    if (outcome.status === DECODER_OUTCOME.rejected) {
      this.addDiagnostic(boundedIssue("frame-rejected", { reason: outcome.issue.code }));
      this.publish(this.currentValues());
      return;
    }

    if (outcome.status === DECODER_OUTCOME.skipped) {
      if (this.state.status === TelemetryStatus.LIVE) {
        if (outcome.envelope.flags & BLE_KEYBOARD_FRAME_FLAGS.streamStart) {
          this.resetStream();
          this.publish(this.currentValues({
            status: TelemetryStatus.AWAITING_STREAM_START,
            lastSequence: null,
            activeLayer: null,
            layerAuthoritative: false,
          }));
        } else {
          this.observeSequence(outcome.envelope);
          this.publish(this.currentValues());
        }
      }
      return;
    }

    const event = outcome.value;
    const envelope = outcome.envelope;
    if (!this.eventAdvertised(envelope.eventType)) {
      this.addDiagnostic(boundedIssue("event-kind-not-advertised", { eventType: envelope.eventType }));
      this.publish(this.currentValues());
      return;
    }

    if (event.streamStart) {
      if (!this.beginStream(event, envelope)) return;
    } else if (this.state.status !== TelemetryStatus.LIVE) {
      return;
    } else {
      this.observeSequence(envelope);
    }

    this.reduceEvent(event, generation, token);
  }

  reduceEvent(event, generation, token) {
    if (event.kind === "key") {
      if (event.action === "down") this.pressed.add(event.position);
      else this.pressed.delete(event.position);
    } else if (event.kind === "combo") {
      this.clearComboTimer(event.comboId);
      if (event.action === "down") {
        this.combos.set(event.comboId, {
          comboId: event.comboId,
          positions: event.positions,
          layer: event.layer,
        });
        const timer = this.schedule(() => {
          this.comboTimers.delete(event.comboId);
          if (!this.owns(generation, token)) return;
          this.combos.delete(event.comboId);
          this.publish(this.currentValues());
        }, this.comboExpiryMs);
        this.comboTimers.set(event.comboId, timer);
      } else {
        this.combos.delete(event.comboId);
      }
    } else if (event.kind === "layer") {
      this.state = freezeSnapshot(this.currentValues({ activeLayer: event.layer, layerAuthoritative: true }));
    } else if (event.kind === "diagnostic") {
      this.addDiagnostic(boundedIssue("keyboard-diagnostic", {
        severity: event.severity,
        message: DIAGNOSTIC_COPY[event.code] ?? `Keyboard diagnostic ${event.code}.`,
        diagnosticCode: event.code,
        source: event.diagnosticSource,
        count: event.count,
        detail: event.detail,
      }));
    }
    this.publish(this.currentValues());
  }

  clearComboTimer(comboId) {
    const timer = this.comboTimers.get(comboId);
    if (timer !== undefined) this.cancelSchedule(timer);
    this.comboTimers.delete(comboId);
  }

  dispose() {
    this.disposed = true;
    this.token += 1;
    this.resetStream();
    this.unsubscribeLifecycle?.();
    this.listeners.clear();
  }
}
