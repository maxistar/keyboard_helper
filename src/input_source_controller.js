import { HIGHLIGHTING_SOURCES } from "./input_events.js";

/** @typedef {import("./input_events.js").HighlightingSource} HighlightingSource */
/** @typedef {import("./input_events.js").NormalizedInputEvent} NormalizedInputEvent */
/** @typedef {{ effectiveSource: HighlightingSource, reason: string | null, bleReady: boolean, capabilitiesValidated: boolean, subscribed: boolean, streamStarted: boolean }} InputSourceControllerSnapshot */
/** @typedef {{ source: HighlightingSource, reason: string }} SourceClearDetail */
/** @typedef {{ previous: HighlightingSource, current: HighlightingSource, reason: string }} EffectiveSourceChange */

/**
 * @param {{
 *   onEvent?: (event: NormalizedInputEvent) => void,
 *   onClearSourceState?: (detail: SourceClearDetail) => void,
 *   onEffectiveSourceChange?: (detail: EffectiveSourceChange) => void,
 *   onStatusChange?: (snapshot: InputSourceControllerSnapshot) => void,
 * }} [options]
 */
export function createInputSourceController({
  onEvent = () => {},
  onClearSourceState = () => {},
  onEffectiveSourceChange = () => {},
  onStatusChange = () => {},
} = {}) {
  let capabilitiesValidated = false;
  let subscribed = false;
  let streamStarted = false;
  /** @type {string | null} */
  let bleReason = "ble-not-connected";
  /** @type {HighlightingSource} */
  let effectiveSource = selectEffectiveSource();

  function bleReady() {
    return capabilitiesValidated && subscribed && streamStarted;
  }

  /** @returns {HighlightingSource} */
  function selectEffectiveSource() {
    return capabilitiesValidated && subscribed && streamStarted
      ? HIGHLIGHTING_SOURCES.BLE
      : HIGHLIGHTING_SOURCES.SYSTEM;
  }

  /** @returns {string | null} */
  function statusReason() {
    if (bleReady()) return null;
    return bleReason;
  }

  /** @returns {Readonly<InputSourceControllerSnapshot>} */
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

  /** @param {string} reason */
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

  /** @param {{ capabilitiesValidated?: boolean, subscribed?: boolean, reason?: string | null }} [connection] */
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

  /** @param {string} [reason] */
  function disconnectBle(reason = "ble-disconnected") {
    capabilitiesValidated = false;
    subscribed = false;
    streamStarted = false;
    bleReason = reason;
    return reconcile("ble-disconnected");
  }

  /** @param {NormalizedInputEvent} event */
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
