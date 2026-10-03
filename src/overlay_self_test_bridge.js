import {
  createSelfTestLayerLeaseCoordinator,
  matchesOrderedLayerRequest,
} from "./self_test/layer_lease.js";

/**
 * @typedef {import("./self_test/layer_lease.js").LayerLeaseRequest} LayerLeaseRequest
 * @typedef {{ payload?: unknown }} TauriEvent
 * @typedef {{ event?: { listen?: (eventName: string, handler: (event: TauriEvent) => void) => Promise<unknown>, emitTo?: (label: string, eventName: string, payload: unknown) => Promise<unknown> } }} TauriLike
 * @typedef {{ update(payload: unknown): void }} SelfTestOverlayPresentation
 * @typedef {{ tauri: TauriLike | undefined, overlayPresentation: SelfTestOverlayPresentation, getInputSourceSnapshot: () => unknown, getActiveLayoutKey: () => string | null, getObservedLayer: () => number | null, isWritable: () => boolean, getLayerKeys: (layoutKey: string | null) => string[], writeLayer: (layer: number, acceptableLayers?: readonly number[]) => Promise<unknown>, setReconciliationSuspended: (suspended: boolean) => void }} OverlaySelfTestBridgeOptions
 */

/** @param {unknown} payload */
function payloadRecord(payload) {
  return payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
}

/** @param {OverlaySelfTestBridgeOptions} options */
export function createOverlaySelfTestBridge({
  tauri,
  overlayPresentation,
  getInputSourceSnapshot,
  getActiveLayoutKey,
  getObservedLayer,
  isWritable,
  getLayerKeys,
  writeLayer,
  setReconciliationSuspended,
}) {
  let sourceStateSubscribed = false;

  /** @param {unknown} status */
  function publishSourceState(status) {
    if (!sourceStateSubscribed || !tauri?.event?.emitTo) return;
    tauri.event
      .emitTo("keyboard-self-test", "self-test-source-state", status)
      .catch(() => { sourceStateSubscribed = false; });
  }

  /** @param {unknown} status */
  function publishLayerLeaseStatus(status) {
    if (!tauri?.event?.emitTo) return;
    tauri.event
      .emitTo("keyboard-self-test", "self-test-layer-lease-status", status)
      .catch(() => {});
  }

  const layerLease = createSelfTestLayerLeaseCoordinator({
    getActiveLayoutKey,
    getObservedLayer,
    isWritable,
    validateLayerRequest: (request) => matchesOrderedLayerRequest(
      getLayerKeys(getActiveLayoutKey()),
      request,
    ),
    writeLayer,
    setReconciliationSuspended,
    onStatus: publishLayerLeaseStatus,
  });

  function installEventListeners() {
    if (!tauri?.event?.listen) return;

    tauri.event
      .listen("self-test-overlay-state", (event) => {
        overlayPresentation.update(event.payload);
      })
      .catch((err) => console.error("Failed to listen self-test-overlay-state:", err));

    tauri.event
      .listen("self-test-source-request", () => {
        sourceStateSubscribed = true;
        publishSourceState(getInputSourceSnapshot());
      })
      .catch((err) => console.error("Failed to listen self-test-source-request:", err));

    tauri.event
      .listen("self-test-layer-lease-request", (event) => {
        layerLease.acquire(/** @type {LayerLeaseRequest} */ (payloadRecord(event.payload)));
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-request:", err));

    tauri.event
      .listen("self-test-layer-lease-reassert", (event) => {
        layerLease.reassert(payloadRecord(event.payload).generation);
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-reassert:", err));

    tauri.event
      .listen("self-test-layer-lease-release", (event) => {
        layerLease.release(payloadRecord(event.payload).generation);
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-release:", err));

    tauri.event
      .listen("self-test-layer-lease-manual", (event) => {
        layerLease.invalidateGeneration(payloadRecord(event.payload).generation, "manual-continuation");
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-manual:", err));
  }

  return {
    installEventListeners,
    publishSourceState,
    /** @param {number | null} layer */
    observeLayer: (layer) => layerLease.observeLayer(layer),
    /** @param {string} message */
    reportUnavailable: (message) => layerLease.reportUnavailable(message),
    /** @param {string} reason */
    invalidate: (reason) => layerLease.invalidate(reason),
  };
}
