import { createBleLayerSyncController } from "./ble_layer_sync.js";
import { normalizeBleKeyboardFrame } from "./input_events.js";

/**
 * @typedef {import("./ble_layer_sync.js").BleLayerSource} BleLayerSource
 * @typedef {import("./ble_layer_sync.js").BleLayerStatus} BleLayerStatus
 * @typedef {{ payload?: unknown }} TauriEvent
 * @typedef {{ event?: { listen?: (eventName: string, handler: (event: TauriEvent) => void) => Promise<unknown> } }} TauriLike
 * @typedef {{ layout?: unknown, state?: unknown, reason?: unknown, capabilitiesValidated?: unknown, subscribed?: unknown, [key: string]: unknown }} BleKeyboardStatusPayload
 * @typedef {{ layout?: unknown, frame?: unknown }} BleKeyboardEventPayload
 * @typedef {{ layout?: unknown, code?: unknown, message?: unknown }} BleKeyboardDiagnosticPayload
 * @typedef {{ layout?: unknown, level?: unknown }} BleBatteryPayload
 * @typedef {{ disconnectBle(reason?: string | null): unknown, setBleConnection(connection?: { capabilitiesValidated?: boolean, subscribed?: boolean, reason?: string | null }): unknown, handleEvent(event: import("./input_events.js").NormalizedInputEvent): unknown, reportSequenceGap(): unknown }} InputSourceController
 * @typedef {{ tauri: TauriLike | undefined, getCurrentLayoutKey: () => string, getBleSource: (layoutKey: string) => BleLayerSource | null | undefined, getInputSourceController: () => InputSourceController, onLayerChange?: (layer: number) => void, onStatusChange?: (status: BleLayerStatus) => void, onKeyboardStatusChange?: (status: BleKeyboardStatusPayload) => void, onDiagnosticMessage?: (message: string) => void, renderBleKeyboardStatus: () => void }} OverlayBleRuntimeOptions
 */

/** @param {unknown} payload */
function asRecord(payload) {
  return payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
}

/** @param {OverlayBleRuntimeOptions} options */
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
  /** @type {number | null} */
  let observedLayer = null;
  /** @type {{ state: string, writable: boolean }} */
  let layerControlStatus = { state: "idle", writable: false };
  /** @type {BleKeyboardStatusPayload | null} */
  let keyboardStatus = null;
  /** @type {number | null} */
  let batteryLevel = null;

  const layerSync = createBleLayerSyncController({
    tauri,
    onLayerChange: (layer) => {
      observedLayer = layer;
      onLayerChange?.(layer);
    },
    onStatusChange: (status) => {
      const state = status.state ?? "idle";
      layerControlStatus = { state, writable: Boolean(status.writable) };
      if (state !== "connected") observedLayer = null;
      onStatusChange?.(status);
    },
  });

  /**
   * @param {string} layoutKey
   * @param {BleLayerSource | null | undefined} [source]
   */
  async function start(layoutKey, source = getBleSource(layoutKey) ?? null) {
    return layerSync.start(layoutKey, source);
  }

  /** @param {string} layoutKey */
  async function reconnect(layoutKey) {
    const source = getBleSource(layoutKey);
    if (layoutKey !== getCurrentLayoutKey() || !source) return false;
    return layerSync.start(layoutKey, source);
  }

  function installEventListeners() {
    if (!tauri?.event?.listen) return;

    tauri.event
      .listen("ble_keyboard_status", (event) => {
        /** @type {BleKeyboardStatusPayload} */
        const payload = asRecord(event.payload);
        if (payload.layout !== getCurrentLayoutKey()) return;
        keyboardStatus = payload;
        renderBleKeyboardStatus();
        onKeyboardStatusChange?.(payload);
        const inputSourceController = getInputSourceController();
        if (["disconnected", "error", "idle"].includes(String(payload.state))) {
          inputSourceController.disconnectBle(typeof payload.reason === "string" ? payload.reason : `ble-${payload.state}`);
          return;
        }
        inputSourceController.setBleConnection({
          capabilitiesValidated: Boolean(payload.capabilitiesValidated),
          subscribed: Boolean(payload.subscribed),
          reason: typeof payload.reason === "string" ? payload.reason : null,
        });
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_status:", err));

    tauri.event
      .listen("ble_keyboard_event", (event) => {
        /** @type {BleKeyboardEventPayload} */
        const payload = asRecord(event.payload);
        if (payload.layout !== getCurrentLayoutKey()) return;
        const normalized = normalizeBleKeyboardFrame(payload.frame);
        if (normalized) getInputSourceController().handleEvent(normalized);
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_event:", err));

    tauri.event
      .listen("ble_keyboard_diagnostic", (event) => {
        /** @type {BleKeyboardDiagnosticPayload} */
        const payload = asRecord(event.payload);
        if (payload.layout !== getCurrentLayoutKey()) return;
        if (payload.code === "sequence-gap") getInputSourceController().reportSequenceGap();
        if (typeof payload.message === "string" && payload.message) onDiagnosticMessage?.(payload.message);
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_diagnostic:", err));

    tauri.event
      .listen("ble_battery_update", (event) => {
        /** @type {BleBatteryPayload} */
        const payload = asRecord(event.payload);
        if (payload.layout !== getCurrentLayoutKey()) return;
        batteryLevel = Number.isInteger(payload.level) && Number(payload.level) >= 0 && Number(payload.level) <= 100
          ? Number(payload.level)
          : null;
        renderBleKeyboardStatus();
      })
      .catch((err) => console.error("Failed to listen ble_battery_update:", err));
  }

  return {
    start,
    reconnect,
    installEventListeners,
    /**
     * @param {number} layer
     * @param {readonly number[]} [acceptableLayers]
     */
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
