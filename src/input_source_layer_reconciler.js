const DEFAULT_SETTLE_MS = 1000;

/** @typedef {import("./input_source_sync_config.js").InputSourceSyncConfig} InputSourceSyncConfig */
/** @typedef {"waiting" | "waiting-keyboard" | "offline" | "read-only" | "suspended" | "unsupported-source" | "synced" | "deferred" | "unmapped-layer" | "synchronizing" | "settling" | "waiting-confirmation" | "error"} InputSourceSyncStatus */
/** @typedef {{ status: InputSourceSyncStatus, message: string | null, sourceId: string | null, observedLayer: number | null, pending: boolean }} InputSourceReconcilerState */
/** @typedef {(callback: () => void | Promise<void>, delay: number) => number} ReconcilerSchedule */

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error);
}

/**
 * @param {{
 *   config: InputSourceSyncConfig,
 *   writeLayer: (layer: number, acceptableLayers: readonly number[]) => Promise<unknown>,
 *   onStateChange?: (state: InputSourceReconcilerState) => void,
 *   settleMs?: number,
 *   schedule?: ReconcilerSchedule,
 *   cancel?: (handle: number) => void,
 * }} options
 */
export function createInputSourceLayerReconciler({
  config,
  writeLayer,
  onStateChange = () => {},
  settleMs = DEFAULT_SETTLE_MS,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}) {
  /** @type {string | null} */
  let sourceId = null;
  /** @type {number | null} */
  let observedLayer = null;
  let bleState = "idle";
  let bleWritable = false;
  /** @type {number | null} */
  let timer = null;
  let generation = 0;
  let pending = false;
  let suspended = false;
  /** @type {InputSourceReconcilerState} */
  let state = { status: "waiting", message: null, sourceId: null, observedLayer: null, pending: false };

  const sourceByInputId = new Map(
    config.sources.map((source) => [source.inputSourceId, source]),
  );
  const familyByLayer = new Map();
  for (const source of config.sources) {
    for (const layer of source.layers) familyByLayer.set(layer, source);
  }
  const neutralLayers = new Set(config.neutralLayers);

  /** @param {InputSourceSyncStatus} status @param {string | null} [message] */
  const publish = (status, message = null) => {
    state = { status, message, sourceId, observedLayer, pending };
    onStateChange({ ...state });
  };

  const cancelSettling = () => {
    generation += 1;
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const connectionStatus = () => {
    if (bleState === "connecting") return "waiting-keyboard";
    if (bleState !== "connected") return "offline";
    if (!bleWritable) return "read-only";
    return null;
  };

  const reconcile = () => {
    cancelSettling();
    if (suspended) {
      publish("suspended", "Self-test controls the keyboard layer");
      return;
    }
    const desired = sourceId === null ? undefined : sourceByInputId.get(sourceId);
    if (!desired) {
      publish(sourceId ? "unsupported-source" : "waiting");
      return;
    }
    if (observedLayer === null) {
      publish(connectionStatus() ?? "waiting-keyboard");
      return;
    }
    const observedFamily = familyByLayer.get(observedLayer);
    if (observedFamily?.id === desired.id) {
      pending = false;
      publish("synced");
      return;
    }
    if (neutralLayers.has(observedLayer)) {
      publish("deferred", "Neutral layer is active");
      return;
    }
    if (!observedFamily) {
      publish("unmapped-layer");
      return;
    }
    if (observedLayer !== observedFamily.baseLayer) {
      publish("deferred", "Transient language layer is active");
      return;
    }
    const unavailable = connectionStatus();
    if (unavailable) {
      publish(unavailable);
      return;
    }
    if (pending) {
      publish("synchronizing");
      return;
    }

    const ownGeneration = generation;
    publish("settling");
    timer = schedule(async () => {
      timer = null;
      if (ownGeneration !== generation) return;
      pending = true;
      publish("synchronizing");
      try {
        await writeLayer(desired.baseLayer, desired.layers);
        if (ownGeneration !== generation) {
          pending = false;
          reconcile();
          return;
        }
        pending = false;
        if (familyByLayer.get(observedLayer)?.id === desired.id) publish("synced");
        else publish("waiting-confirmation");
      } catch (error) {
        if (ownGeneration !== generation) {
          pending = false;
          reconcile();
          return;
        }
        pending = false;
        publish("error", errorMessage(error));
      }
    }, settleMs);
  };

  return {
    /** @param {string | null | undefined} nextSourceId */
    setSource(nextSourceId) {
      sourceId = nextSourceId ?? null;
      reconcile();
    },
    /** @param {unknown} layer */
    setLayer(layer) {
      observedLayer = typeof layer === "number" && Number.isInteger(layer) && layer >= 0 ? layer : null;
      reconcile();
    },
    /** @param {string | null | undefined} nextState @param {boolean} [writable] */
    setBleStatus(nextState, writable = false) {
      bleState = nextState ?? "idle";
      bleWritable = Boolean(writable);
      reconcile();
    },
    /** @param {unknown} nextSuspended */
    setSuspended(nextSuspended) {
      const next = Boolean(nextSuspended);
      if (next === suspended) return;
      suspended = next;
      reconcile();
    },
    resume: reconcile,
    dispose() {
      cancelSettling();
    },
    getState: () => ({ ...state }),
  };
}
