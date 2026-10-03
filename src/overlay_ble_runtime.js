import { createBleLayerSyncController } from "./ble_layer_sync.js";
import { normalizeBleKeyboardFrame } from "./input_events.js";

export function createOverlayBleRuntime({
  tauri,
  getCurrentLayoutKey,
  getBleSource,
  getInputSourceController,
  onLayerChange,
  onStatusChange,
  onKeyboardStatusChange,
  onDiagnosticMessage,
  renderBleKeyboardStatus,
}) {
  let observedLayer = null;
  let layerControlStatus = { state: "idle", writable: false };
  let keyboardStatus = null;
  let batteryLevel = null;

  const layerSync = createBleLayerSyncController({
    tauri,
    onLayerChange: (layer) => {
      observedLayer = layer;
      onLayerChange?.(layer);
    },
    onStatusChange: (status) => {
      layerControlStatus = { state: status.state, writable: Boolean(status.writable) };
      if (status.state !== "connected") observedLayer = null;
      onStatusChange?.(status);
    },
  });

  async function start(layoutKey, source = getBleSource(layoutKey) ?? null) {
    return layerSync.start(layoutKey, source);
  }

  async function reconnect(layoutKey) {
    const source = getBleSource(layoutKey);
    if (layoutKey !== getCurrentLayoutKey() || !source) return false;
    return layerSync.start(layoutKey, source);
  }

  function installEventListeners() {
    if (!tauri?.event?.listen) return;

    tauri.event
      .listen("ble_keyboard_status", (event) => {
        const payload = event.payload ?? {};
        if (payload.layout !== getCurrentLayoutKey()) return;
        keyboardStatus = payload;
        renderBleKeyboardStatus();
        onKeyboardStatusChange?.(payload);
        const inputSourceController = getInputSourceController();
        if (["disconnected", "error", "idle"].includes(payload.state)) {
          inputSourceController.disconnectBle(payload.reason ?? `ble-${payload.state}`);
          return;
        }
        inputSourceController.setBleConnection({
          capabilitiesValidated: Boolean(payload.capabilitiesValidated),
          subscribed: Boolean(payload.subscribed),
          reason: payload.reason,
        });
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_status:", err));

    tauri.event
      .listen("ble_keyboard_event", (event) => {
        const payload = event.payload ?? {};
        if (payload.layout !== getCurrentLayoutKey()) return;
        const normalized = normalizeBleKeyboardFrame(payload.frame);
        if (normalized) getInputSourceController().handleEvent(normalized);
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_event:", err));

    tauri.event
      .listen("ble_keyboard_diagnostic", (event) => {
        const payload = event.payload ?? {};
        if (payload.layout !== getCurrentLayoutKey()) return;
        if (payload.code === "sequence-gap") getInputSourceController().reportSequenceGap();
        if (payload.message) onDiagnosticMessage?.(payload.message);
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_diagnostic:", err));

    tauri.event
      .listen("ble_battery_update", (event) => {
        const payload = event.payload ?? {};
        if (payload.layout !== getCurrentLayoutKey()) return;
        batteryLevel = Number.isInteger(payload.level) && payload.level >= 0 && payload.level <= 100
          ? payload.level
          : null;
        renderBleKeyboardStatus();
      })
      .catch((err) => console.error("Failed to listen ble_battery_update:", err));
  }

  return {
    start,
    reconnect,
    installEventListeners,
    writeLayer: (layer, acceptableLayers) => layerSync.writeLayer(layer, acceptableLayers),
    getActiveLayoutKey: () => layerSync.getActiveLayoutKey(),
    getObservedLayer: () => observedLayer,
    getLayerControlStatus: () => layerControlStatus,
    isWritable: () => layerControlStatus.state === "connected"
      && layerControlStatus.writable
      && layerSync.getActiveLayoutKey() === getCurrentLayoutKey(),
    getKeyboardStatus: () => keyboardStatus,
    getBatteryLevel: () => batteryLevel,
  };
}
