function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeBleLayerSource(layoutDefinition) {
  const source = layoutDefinition?.bleLayerSource;
  if (!source || typeof source !== "object") return null;

  const deviceName = isNonEmptyString(source.deviceName)
    ? source.deviceName.trim()
    : null;
  const serviceUuid = isNonEmptyString(source.serviceUuid)
    ? source.serviceUuid.trim()
    : null;
  const characteristicUuid = isNonEmptyString(source.characteristicUuid)
    ? source.characteristicUuid.trim()
    : null;
  const format = isNonEmptyString(source.format) ? source.format.trim() : "int32-le";

  if (!deviceName || !serviceUuid || !characteristicUuid) {
    return null;
  }

  if (format !== "int32-le") {
    return null;
  }

  return {
    deviceName,
    serviceUuid,
    characteristicUuid,
    format,
  };
}

export function createBleLayerSyncController({ tauri, onLayerChange, onStatusChange = () => {} }) {
  let sessionId = 0;
  let activeLayoutKey = null;
  let activeSource = null;
  let unlistenLayer = null;
  let unlistenStatus = null;

  const emitStatus = (status) => {
    onStatusChange({
      available: Boolean(activeSource),
      layoutKey: activeLayoutKey,
      ...status,
    });
  };

  const ensureListeners = async () => {
    if (unlistenLayer || !tauri?.event?.listen) return;

    unlistenLayer = await tauri.event.listen("ble_layer_update", (event) => {
      const payload = event.payload ?? {};
      if (payload.layout !== activeLayoutKey) return;
      if (!Number.isInteger(payload.layer)) return;
      onLayerChange(payload.layer, { source: "ble" });
    });

    unlistenStatus = await tauri.event.listen("ble_layer_status", (event) => {
      const payload = event.payload ?? {};
      if (payload.layout !== activeLayoutKey) return;
      emitStatus({
        state: payload.state ?? "idle",
        message: payload.message ?? null,
        writable: Boolean(payload.writable),
      });
    });
  };

  const clearListeners = async () => {
    if (typeof unlistenLayer === "function") {
      await unlistenLayer();
    }
    if (typeof unlistenStatus === "function") {
      await unlistenStatus();
    }
    unlistenLayer = null;
    unlistenStatus = null;
  };

  const stop = async () => {
    sessionId += 1;
    activeLayoutKey = null;
    activeSource = null;
    if (tauri?.core?.invoke) {
      await tauri.core.invoke("stop_ble_layer_sync").catch((error) => {
        console.error("Failed to stop BLE layer sync:", error);
      });
    }
    await clearListeners();
    emitStatus({ state: "idle", message: null });
  };

  const start = async (layoutKey, source) => {
    const nextSessionId = sessionId + 1;
    await stop();
    sessionId = nextSessionId;
    activeLayoutKey = layoutKey;
    activeSource = source;

    if (!source || !tauri?.core?.invoke || !tauri?.event?.listen) {
      emitStatus({ state: "idle", message: null });
      return false;
    }

    await ensureListeners();
    emitStatus({ state: "connecting", message: null });

    try {
      await tauri.core.invoke("start_ble_layer_sync", {
        config: {
          layoutKey,
          deviceName: source.deviceName,
          serviceUuid: source.serviceUuid,
          characteristicUuid: source.characteristicUuid,
          format: source.format,
        },
      });
      return true;
    } catch (error) {
      console.error("Failed to start BLE layer sync:", error);
      emitStatus({
        state: "error",
        message: error?.message ?? String(error),
      });
      return false;
    }
  };

  const dispose = async () => {
    await stop();
  };

  const writeLayer = async (layer, acceptableLayers = [layer]) => {
    if (!activeLayoutKey || !activeSource || !tauri?.core?.invoke) {
      throw new Error("BLE layer session is unavailable");
    }
    if (!Number.isInteger(layer) || layer < 0) {
      throw new Error("BLE layer index must be a non-negative integer");
    }
    const normalizedAcceptable = [...new Set(acceptableLayers)].filter(
      (candidate) => Number.isInteger(candidate) && candidate >= 0,
    );
    if (!normalizedAcceptable.includes(layer)) {
      throw new Error("acceptableLayers must include the requested layer");
    }
    await tauri.core.invoke("write_ble_layer", {
      layoutKey: activeLayoutKey,
      layer,
      acceptableLayers: normalizedAcceptable,
    });
  };

  return {
    start,
    stop,
    dispose,
    writeLayer,
    getActiveLayoutKey: () => activeLayoutKey,
    getActiveSource: () => activeSource,
  };
}
