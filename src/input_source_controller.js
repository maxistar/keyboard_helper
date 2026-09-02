import { HIGHLIGHTING_SOURCES } from "./input_events.js";

export function createInputSourceController({
  onEvent = () => {},
  onClearSourceState = () => {},
  onEffectiveSourceChange = () => {},
  onStatusChange = () => {},
} = {}) {
  let capabilitiesValidated = false;
  let subscribed = false;
  let streamStarted = false;
  let bleReason = "ble-not-connected";
  let effectiveSource = selectEffectiveSource();

  function bleReady() {
    return capabilitiesValidated && subscribed && streamStarted;
  }

  function selectEffectiveSource() {
    return capabilitiesValidated && subscribed && streamStarted
      ? HIGHLIGHTING_SOURCES.BLE
      : HIGHLIGHTING_SOURCES.SYSTEM;
  }

  function statusReason() {
    if (bleReady()) return null;
    return bleReason;
  }

  function snapshot() {
    return Object.freeze({
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

  function reconcile(reason) {
    const previous = effectiveSource;
    const next = selectEffectiveSource();
    if (previous !== next) {
      if (previous) onClearSourceState({ source: previous, reason });
      effectiveSource = next;
      onEffectiveSourceChange({ previous, current: next, reason });
    }
    return publishStatus();
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
    setBleConnection,
    disconnectBle,
    handleEvent,
    reportSequenceGap,
  };
}
