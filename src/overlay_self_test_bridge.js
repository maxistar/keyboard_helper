import {
  createSelfTestLayerLeaseCoordinator,
  matchesOrderedLayerRequest,
} from "./self_test/layer_lease.js";

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

  function publishSourceState(status) {
    if (!sourceStateSubscribed || !tauri?.event?.emitTo) return;
    tauri.event
      .emitTo("keyboard-self-test", "self-test-source-state", status)
      .catch(() => { sourceStateSubscribed = false; });
  }

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
        layerLease.acquire(event.payload ?? {});
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-request:", err));

    tauri.event
      .listen("self-test-layer-lease-reassert", (event) => {
        layerLease.reassert(event.payload?.generation);
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-reassert:", err));

    tauri.event
      .listen("self-test-layer-lease-release", (event) => {
        layerLease.release(event.payload?.generation);
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-release:", err));

    tauri.event
      .listen("self-test-layer-lease-manual", (event) => {
        layerLease.invalidateGeneration(event.payload?.generation, "manual-continuation");
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-manual:", err));
  }

  return {
    installEventListeners,
    publishSourceState,
    observeLayer: (layer) => layerLease.observeLayer(layer),
    reportUnavailable: (message) => layerLease.reportUnavailable(message),
    invalidate: (reason) => layerLease.invalidate(reason),
  };
}
