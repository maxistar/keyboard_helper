function errorMessage(error) {
  return error?.message ?? String(error);
}

function validRequest(request) {
  return Number.isInteger(request?.generation)
    && request.generation >= 0
    && typeof request.layoutKey === "string"
    && request.layoutKey.length > 0
    && typeof request.layerKey === "string"
    && request.layerKey.length > 0
    && Number.isInteger(request.firmwareLayerIndex)
    && request.firmwareLayerIndex >= 0;
}

export function matchesOrderedLayerRequest(layerKeys, request) {
  if (!Array.isArray(layerKeys)) return false;
  const layerIndex = layerKeys.indexOf(request?.layerKey);
  return layerIndex >= 0 && layerIndex === request?.firmwareLayerIndex;
}

export function createSelfTestLayerLeaseCoordinator({
  getActiveLayoutKey,
  getObservedLayer,
  isWritable,
  validateLayerRequest = () => true,
  writeLayer,
  setReconciliationSuspended = () => {},
  onStatus = () => {},
}) {
  let lease = null;

  const snapshot = () => (lease ? { ...lease } : null);

  const publish = (state, message = null, extra = {}) => {
    if (lease) {
      lease = { ...lease, state, message };
      onStatus({ ...lease, ...extra });
    } else {
      onStatus({ state, message, ...extra });
    }
  };

  const reject = (request, message) => {
    onStatus({
      generation: request?.generation ?? null,
      layoutKey: request?.layoutKey ?? null,
      layerKey: request?.layerKey ?? null,
      requestedLayer: request?.firmwareLayerIndex ?? null,
      state: "unavailable",
      message,
    });
    return false;
  };

  const acquire = async (request) => {
    if (!validRequest(request)) return reject(request, "Invalid self-test layer request");
    if (request.layoutKey !== getActiveLayoutKey()) {
      return reject(request, "Selected layout is not active in the overlay");
    }
    if (!validateLayerRequest(request)) {
      return reject(request, "Selected layer mapping does not match the active overlay layout");
    }
    if (!isWritable()) return reject(request, "Writable BLE layer control is unavailable");
    const previousLayer = getObservedLayer();
    if (!Number.isInteger(previousLayer) || previousLayer < 0) {
      return reject(request, "The authoritative keyboard layer is unknown");
    }
    if (lease) invalidate("replaced-by-newer-request");
    lease = {
      generation: request.generation,
      layoutKey: request.layoutKey,
      layerKey: request.layerKey,
      requestedLayer: request.firmwareLayerIndex,
      previousLayer,
      state: "activating",
      message: null,
    };
    setReconciliationSuspended(true);
    publish("activating");
    const ownGeneration = request.generation;
    try {
      await writeLayer(request.firmwareLayerIndex, [request.firmwareLayerIndex]);
      if (lease?.generation !== ownGeneration) return false;
      if (getObservedLayer() !== request.firmwareLayerIndex) {
        publish("error", "Layer write completed without matching authoritative confirmation");
        return false;
      }
      publish("active");
      return true;
    } catch (error) {
      if (lease?.generation !== ownGeneration) return false;
      publish("error", errorMessage(error));
      return false;
    }
  };

  const observeLayer = (layer) => {
    if (!lease || !Number.isInteger(layer) || layer < 0) return false;
    if (lease.state === "activating") return false;
    if (layer === lease.requestedLayer) {
      if (lease.state === "lost") publish("active");
      return true;
    }
    if (["active", "lost", "error"].includes(lease.state)) {
      publish("lost", `Active layer changed to ${layer}`, { observedLayer: layer });
      return true;
    }
    return false;
  };

  const reassert = async (generation) => {
    if (!lease || lease.generation !== generation || !["lost", "error"].includes(lease.state)) return false;
    if (!isWritable()) {
      publish("error", "Writable BLE layer control is unavailable");
      return false;
    }
    const ownGeneration = lease.generation;
    publish("reactivating");
    try {
      await writeLayer(lease.requestedLayer, [lease.requestedLayer]);
      if (lease?.generation !== ownGeneration) return false;
      if (getObservedLayer() !== lease.requestedLayer) {
        publish("error", "Layer reactivation was not confirmed");
        return false;
      }
      publish("active");
      return true;
    } catch (error) {
      if (lease?.generation !== ownGeneration) return false;
      publish("error", errorMessage(error));
      return false;
    }
  };

  const invalidate = (reason = "superseded") => {
    if (!lease) return false;
    const invalidated = { ...lease };
    lease = null;
    setReconciliationSuspended(false);
    onStatus({ ...invalidated, state: "invalidated", message: reason });
    return true;
  };

  const invalidateGeneration = (generation, reason = "superseded") => {
    if (!lease || lease.generation !== generation) return false;
    return invalidate(reason);
  };

  const reportUnavailable = (message = "Writable BLE layer control is unavailable") => {
    if (!lease) return false;
    publish("error", message);
    return true;
  };

  const release = async (generation) => {
    if (!lease || lease.generation !== generation) return false;
    const releasing = { ...lease };
    lease = null;
    let restored = false;
    let message = null;
    try {
      if (getObservedLayer() === releasing.requestedLayer
        && releasing.previousLayer !== releasing.requestedLayer
        && isWritable()) {
        await writeLayer(releasing.previousLayer, [releasing.previousLayer]);
        restored = getObservedLayer() === releasing.previousLayer;
        if (!restored) message = "Previous layer restoration was not confirmed";
      }
    } catch (error) {
      message = errorMessage(error);
    } finally {
      setReconciliationSuspended(false);
    }
    onStatus({
      ...releasing,
      state: message ? "release-error" : "released",
      message,
      restored,
    });
    return true;
  };

  return {
    acquire,
    observeLayer,
    reassert,
    invalidate,
    invalidateGeneration,
    reportUnavailable,
    release,
    getState: snapshot,
  };
}
