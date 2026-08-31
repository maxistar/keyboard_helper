import {
  HIGHLIGHTING_POLICIES,
  HIGHLIGHTING_SOURCES,
  normalizeHighlightingPolicy,
} from "./input_events.js";

export function createInputSourceController({
  policy = HIGHLIGHTING_POLICIES.AUTO,
  onEvent = () => {},
  onClearSourceState = () => {},
  onEffectiveSourceChange = () => {},
  onStatusChange = () => {},
} = {}) {
  let configuredPolicy = normalizeHighlightingPolicy(policy);
  let capabilitiesValidated = false;
  let subscribed = false;
  let streamStarted = false;
  let bleReason = "ble-not-connected";
  let effectiveSource = selectEffectiveSource();

  function bleReady() {
    return capabilitiesValidated && subscribed && streamStarted;
  }

  function selectEffectiveSource() {
    if (configuredPolicy === HIGHLIGHTING_POLICIES.SYSTEM) return HIGHLIGHTING_SOURCES.SYSTEM;
    if (configuredPolicy === HIGHLIGHTING_POLICIES.BLE) {
      return capabilitiesValidated && subscribed && streamStarted ? HIGHLIGHTING_SOURCES.BLE : null;
    }
    return capabilitiesValidated && subscribed && streamStarted
      ? HIGHLIGHTING_SOURCES.BLE
      : HIGHLIGHTING_SOURCES.SYSTEM;
  }

  function statusReason() {
    if (configuredPolicy === HIGHLIGHTING_POLICIES.SYSTEM) return "system-listener-forced";
    if (bleReady()) return null;
    return bleReason;
  }

  function snapshot() {
    return Object.freeze({
      configuredPolicy,
      effectiveSource,
      reason: statusReason(),
      bleReady: bleReady(),
      capabilitiesValidated,
      subscribed,
      streamStarted,
    });
  }

  function publishStatus() {
    const current = snapshot();
    onStatusChange(current);
    return current;
  }

  function reconcile(reason, previousAlreadyCleared = false) {
    const previous = effectiveSource;
    const next = selectEffectiveSource();
    if (previous !== next) {
      if (previous && !previousAlreadyCleared) onClearSourceState({ source: previous, reason });
      effectiveSource = next;
      onEffectiveSourceChange({ previous, current: next, reason });
    }
    return publishStatus();
  }

  function setPolicy(nextPolicy) {
    const normalized = normalizeHighlightingPolicy(nextPolicy);
    if (normalized === configuredPolicy) return snapshot();
    const previous = effectiveSource;
    if (previous) onClearSourceState({ source: previous, reason: "policy-changed" });
    configuredPolicy = normalized;
    return reconcile("policy-changed", true);
  }

  function setBleConnection({
    capabilitiesValidated: nextCapabilities = capabilitiesValidated,
    subscribed: nextSubscribed = subscribed,
    reason = null,
  } = {}) {
    capabilitiesValidated = Boolean(nextCapabilities);
    subscribed = Boolean(nextSubscribed);
    if (!capabilitiesValidated || !subscribed) streamStarted = false;
    bleReason = reason ?? (!capabilitiesValidated
      ? "ble-capabilities-unavailable"
      : !subscribed
        ? "ble-subscription-pending"
        : "ble-stream-start-pending");
    return reconcile("ble-readiness-changed");
  }

  function disconnectBle(reason = "ble-disconnected") {
    capabilitiesValidated = false;
    subscribed = false;
    streamStarted = false;
    bleReason = reason;
    return reconcile("ble-disconnected");
  }

  function handleEvent(event) {
    if (!event || !Object.values(HIGHLIGHTING_SOURCES).includes(event.source)) return false;
    if (
      event.source === HIGHLIGHTING_SOURCES.BLE
      && event.streamStart
      && capabilitiesValidated
      && subscribed
      && !streamStarted
    ) {
      streamStarted = true;
      bleReason = null;
      reconcile("ble-stream-start");
    }
    if (event.source !== effectiveSource) return false;
    onEvent(event);
    return true;
  }

  function reportSequenceGap() {
    if (effectiveSource === HIGHLIGHTING_SOURCES.BLE) {
      onClearSourceState({ source: HIGHLIGHTING_SOURCES.BLE, reason: "sequence-gap" });
    }
    return publishStatus();
  }

  publishStatus();

  return {
    getSnapshot: snapshot,
    setPolicy,
    setBleConnection,
    disconnectBle,
    handleEvent,
    reportSequenceGap,
  };
}
