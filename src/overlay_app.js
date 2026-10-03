import { createMenu } from "./menu.js";
import { createAppMenuStateController } from "./app_menu_state.js";
import { createPressedKeyTracker } from "./key_highlight.js";
import { normalizeSystemKeyEvent } from "./input_events.js";
import { createInputSourceController } from "./input_source_controller.js";
import { createBleHighlightController } from "./ble_highlight.js";
import { createGlobalOverlayHotkey } from "./global_overlay_hotkey.js";
import { routeSystemKeyEvent } from "./system_key_event_router.js";
import { normalizeConfig, pickAvailableLayout } from "./app_config.js";
import { reloadOverlayAfterSettingsSave } from "./settings_runtime.js";
import { createBackgroundAnalytics } from "./typing_analytics.js";
import {
  createOverlayModeController,
  createOverlayModeView,
} from "./overlay_mode.js";
import { detectRuntimePlatform } from "./input_source_sync_config.js";
import { createSelfTestOverlayPresentation } from "./self_test/overlay_presentation.js";
import { createOverlayLayoutRegistry } from "./overlay_layouts.js";
import { createOverlayPresentation } from "./overlay_presentation.js";
import { createOverlayInputRouter } from "./overlay_input_router.js";
import { createOverlayLanguageSync } from "./overlay_language_sync.js";
import { createOverlayBleRuntime } from "./overlay_ble_runtime.js";
import { createOverlaySelfTestBridge } from "./overlay_self_test_bridge.js";
import { createOverlayActions } from "./overlay_actions.js";

/**
 * @typedef {import("./app_config.js").AppConfig} AppConfig
 * @typedef {import("./app_config.js").LayoutSource} LayoutSource
 * @typedef {import("./layout_semantics.js").LayoutDefinition} LayoutDefinition
 * @typedef {import("./layout_semantics.js").KeyEntry} KeyEntry
 * @typedef {import("./layout_catalog.js").LayoutModel} LayoutModel
 * @typedef {import("./ble_layer_sync.js").BleLayerSource} BleLayerSource
 * @typedef {import("./ble_layer_sync.js").BleLayerStatus} BleLayerStatus
 * @typedef {import("./menu.js").MenuControls} MenuControls
 * @typedef {import("./app_menu_state.js").AppMenuStateController} AppMenuStateController
 * @typedef {import("./overlay_mode.js").OverlayModeController} OverlayModeController
 * @typedef {import("./typing_analytics.js").BackgroundAnalytics} BackgroundAnalytics
 * @typedef {import("./global_overlay_hotkey.js").GlobalOverlayHotkey} GlobalOverlayHotkey
 * @typedef {import("./ble_highlight.js").BleHighlightController} BleHighlightController
 * @typedef {import("./input_source_controller.js").InputSourceControllerSnapshot} InputSourceControllerSnapshot
 * @typedef {{ core: { invoke: (command: string, args?: unknown) => Promise<unknown> }, event: { listen: (eventName: string, handler: (event: { payload?: unknown }) => void) => Promise<unknown> }, opener?: { openUrl?: (url: string) => Promise<unknown> } }} TauriHandle
 * @typedef {{ setDisplayMode(mode: string, geometry?: unknown): void }} WindowModeControls
 * @typedef {{ reloadCurrentLayout(key: string): Promise<unknown>, reconnectCurrentBle(key: string): Promise<unknown>, openHelpPage(url: string): Promise<unknown>, openTypingInvaders(): Promise<unknown>, openKeyboardSnake(): Promise<unknown>, openFlappyKeyBird(): Promise<unknown>, openUnderwaterTypingFishing(): Promise<unknown>, openTypingInsightsWindow(): Promise<unknown>, openSettingsWindow(): Promise<unknown>, openKeyboardSelfTest(): Promise<unknown>, enterMiniMode(): Promise<unknown>, setLayout(key: string): Promise<unknown> }} OverlayActions
 * @typedef {{ start(layoutKey: string, source?: BleLayerSource | null): Promise<unknown>, reconnect(layoutKey: string): Promise<unknown>, installEventListeners(): void, writeLayer(layer: number, acceptableLayers?: readonly number[]): Promise<unknown>, getObservedLayer(): number | null, isWritable(): boolean, getKeyboardStatus(): unknown, getBatteryLevel(): number | null }} OverlayBleRuntime
 * @typedef {{ createAdapter(): unknown, installRefreshListeners(): void, start(layoutKey: string): Promise<unknown>, select(inputSourceId: string): Promise<unknown>, setLayer(layer: number): void, setBleStatus(state: string, writable: boolean): void, setSuspended(suspended: boolean): void, getState(): { currentInputSourceId: string | null } }} OverlayLanguageSync
 * @typedef {{ publishSourceState(status: unknown): void, installEventListeners(): void, observeLayer(layer: number | null): void, reportUnavailable(message: string): void, invalidate(reason: string): void }} OverlaySelfTestBridge
 * @typedef {{ handleEvent(event: import("./input_events.js").NormalizedInputEvent): unknown, disconnectBle(reason?: string | null): unknown, setBleConnection(connection?: { capabilitiesValidated?: boolean, subscribed?: boolean, reason?: string | null }): unknown, reportSequenceGap(): unknown, getSnapshot(): InputSourceControllerSnapshot }} InputSourceController
 * @typedef {Window & { __TAURI__?: TauriHandle, setupWindowModeToggle?: (tauri: TauriHandle) => WindowModeControls }} OverlayWindow
 */

const runtimePlatform = detectRuntimePlatform();
const layoutRegistry = createOverlayLayoutRegistry({ runtimePlatform });
/** @type {Record<string, LayoutDefinition>} */
let layoutDefinitions = {};
/** @type {Record<string, LayoutModel>} */
let layouts = {};
/** @type {Record<string, KeyEntry[][]>} */
let layoutLayers = {};
/** @type {Record<string, string[]>} */
let layoutLayerNames = {};
/** @type {Record<string, string[]>} */
let layoutLayerKeys = {};
/** @type {Record<string, LayoutSource>} */
let layoutSources = {};
/** @type {Record<string, BleLayerSource | null>} */
let layoutBleSources = {};
/** @type {Record<string, import("./input_source_sync_config.js").InputSourceSyncConfig | null>} */
let layoutInputSourceSync = {};
/** @type {Record<string, Array<{ key1: { row: number, col: number }, key2: { row: number, col: number }, code: string, id: number | null }>>} */
let comboDefinitionsByLayout = {};

/** @type {string[]} */
let layoutLoadErrors = [];
/** @type {OverlaySelfTestBridge | null} */
let selfTestBridge = null;

function syncLayoutState() {
  layoutDefinitions = layoutRegistry.layoutDefinitions;
  layoutLayers = layoutRegistry.layoutLayers;
  layoutLayerNames = layoutRegistry.layoutLayerNames;
  layoutLayerKeys = layoutRegistry.layoutLayerKeys;
  layouts = layoutRegistry.layouts;
  layoutSources = layoutRegistry.layoutSources;
  layoutBleSources = layoutRegistry.layoutBleSources;
  layoutInputSourceSync = /** @type {Record<string, import("./input_source_sync_config.js").InputSourceSyncConfig | null>} */ (layoutRegistry.layoutInputSourceSync);
  comboDefinitionsByLayout = layoutRegistry.comboDefinitionsByLayout;
  layoutLoadErrors = layoutRegistry.layoutLoadErrors;
}

/** @param {AppConfig | null | undefined} config */
async function loadLayoutDefinitions(config) {
  await layoutRegistry.loadLayoutDefinitions(config);
  syncLayoutState();
}

window.addEventListener("pagehide", () => layoutRegistry.dispose(), { once: true });

const layoutRoot = /** @type {HTMLElement} */ (document.getElementById("layoutRoot"));
const selfTestOverlayPresentation = createSelfTestOverlayPresentation({ root: layoutRoot });
let currentLayerIndex = 0;
/** @type {MenuControls} */
let menuControls;
/** @type {AppMenuStateController} */
let menuStateController;
/** @type {OverlayModeController} */
let overlayModeController;
/** @type {WindowModeControls | null} */
let windowModeControls = null;
let currentLayoutKey = "qwerty";
/** @type {OverlayActions} */
let overlayActions;
/** @type {OverlayBleRuntime} */
let bleRuntime;
/** @type {OverlayLanguageSync} */
let languageSync;
/** @type {TauriHandle | null | undefined} */
let tauriHandle = null;
/** @type {InputSourceController} */
let inputSourceController;
/** @type {GlobalOverlayHotkey | null} */
let globalOverlayHotkey = null;
/** @type {BleHighlightController | null} */
let bleHighlightController = null;
/** @type {InputSourceControllerSnapshot | null} */
let highlightingStatus = null;

/** @type {BackgroundAnalytics | null} */
let backgroundAnalytics = null;
const pressedKeyTracker = createPressedKeyTracker();
const overlayPresentation = createOverlayPresentation({
  document,
  layoutRoot,
  pressedKeyTracker,
  selfTestOverlayPresentation,
  getCurrentLayoutKey: () => currentLayoutKey,
  getCurrentLayerIndex: () => currentLayerIndex,
  setCurrentLayerIndex: (index) => { currentLayerIndex = index; },
  getLayouts: () => layouts,
  getLayoutLayers: () => layoutLayers,
  getLayoutLayerNames: () => layoutLayerNames,
  getComboDefinitionsByLayout: () => comboDefinitionsByLayout,
  getBleStatus: () => ({
    highlightingStatus,
    bleKeyboardStatus: bleRuntime?.getKeyboardStatus() ?? null,
    bleBatteryLevel: bleRuntime?.getBatteryLevel() ?? null,
  }),
  refreshMiniGeometry: () => overlayModeController?.refreshMiniGeometry(),
});

/** @param {LayoutModel} layout */
const renderKeyboard = (layout) => overlayPresentation.renderKeyboard(layout);
/** @param {string | null} message */
const showLayoutError = (message) => overlayPresentation.showLayoutError(message ?? "");
/** @param {string | null | undefined} code */
const showKeyEvent = (code) => overlayPresentation.showKeyEvent(code);
const renderBleKeyboardStatus = () => overlayPresentation.renderBleKeyboardStatus();
/** @param {number} index */
const applyLayer = (index) => overlayPresentation.applyLayer(index);
/** @param {string} code @param {boolean} active */
const setComboActive = (code, active) => overlayPresentation.setComboActive(code, active);
/** @param {number} comboId @param {boolean} active */
const setBleComboActive = (comboId, active) => overlayPresentation.setBleComboActive(comboId, active);
const inputRouter = createOverlayInputRouter({
  document,
  pressedKeyTracker,
  getBleHighlightController: () => /** @type {import("./overlay_input_router.js").BleHighlightController | null} */ (bleHighlightController),
  setComboActive,
  clearComboActivations: () => overlayPresentation.clearComboActivations(),
  showKeyEvent,
});
/** @param {import("./overlay_input_router.js").NormalizedInputEvent} event */
const handleNormalizedInputEvent = (event) => inputRouter.handleNormalizedInputEvent(event);
const clearHighlightState = () => inputRouter.clearHighlightState();

/** @param {string} layoutKey */
async function startLanguageSync(layoutKey) {
  return languageSync?.start(layoutKey) ?? false;
}

/** @param {string} inputSourceId */
async function selectLanguage(inputSourceId) {
  return languageSync?.select(inputSourceId) ?? false;
}

/** @param {AppConfig | null | undefined} _config */
function getAllowedLayoutKeys(_config) {
  return layoutRegistry.getAllowedLayoutKeys();
}

/**
 * @param {AppConfig | null | undefined} config
 * @param {string[]} allowedKeys
 */
function pickDefaultLayout(config, allowedKeys) {
  const preferred = config?.defaultLayout;
  console.log("Preferred layout from config:", preferred);
  return pickAvailableLayout(config, allowedKeys, currentLayoutKey) ?? currentLayoutKey;
}

async function loadConfig() {
  const tauri = /** @type {OverlayWindow} */ (window).__TAURI__;
  if (!tauri?.core?.invoke) return normalizeConfig(null);
  try {
    const result = /** @type {{ status?: string, data?: unknown, sourcePath?: string, path?: string }} */ (await tauri.core.invoke("read_config_state"));
    if (result?.status === "valid") return normalizeConfig(result.data);
    if (result?.status === "invalid") {
      showLayoutError(`Configuration error in ${result.sourcePath ?? result.path}. Using defaults.`);
    }
    return normalizeConfig(null);
  } catch (err) {
    console.warn("Failed to load config file, using defaults", err);
    showLayoutError("Could not read settings. Using built-in layouts.");
    return normalizeConfig(null);
  }
}


/** @param {string} key */
const reloadCurrentLayout = (key) => overlayActions.reloadCurrentLayout(key);
/** @param {string} key */
const reconnectCurrentBle = (key) => overlayActions.reconnectCurrentBle(key);
/** @param {string} url */
const openHelpPage = (url) => overlayActions.openHelpPage(url);
const openTypingInvaders = () => overlayActions.openTypingInvaders();
const openKeyboardSnake = () => overlayActions.openKeyboardSnake();
const openFlappyKeyBird = () => overlayActions.openFlappyKeyBird();
const openUnderwaterTypingFishing = () => overlayActions.openUnderwaterTypingFishing();
const openTypingInsightsWindow = () => overlayActions.openTypingInsightsWindow();
const openSettingsWindow = () => overlayActions.openSettingsWindow();
const openKeyboardSelfTest = () => overlayActions.openKeyboardSelfTest();
const enterMiniMode = () => overlayActions.enterMiniMode();
/** @param {string} key */
const setLayout = (key) => overlayActions.setLayout(key);

window.addEventListener("DOMContentLoaded", async () => {
  const tauri = /** @type {OverlayWindow} */ (window).__TAURI__;
  tauriHandle = tauri;
  if (tauri?.core?.invoke && tauri?.event?.listen) {
    let startupGeometry = { decorations: true };
    try {
      startupGeometry = /** @type {{ decorations: boolean }} */ (await tauri.core.invoke("restore_full_geometry"));
    } catch (error) {
      console.error("Failed to initialize full overlay geometry:", error);
      showLayoutError(error instanceof Error ? error.message : String(error));
    }
    const overlayWindow = /** @type {OverlayWindow} */ (window);
    if (typeof overlayWindow.setupWindowModeToggle === "function") {
      windowModeControls = overlayWindow.setupWindowModeToggle(tauri);
      windowModeControls?.setDisplayMode("full", startupGeometry);
    }
    const modeView = createOverlayModeView({
      body: document.body,
      stage: document.getElementById("overlayStage"),
      layout: layoutRoot,
      restoreButton: document.getElementById("restoreFullSize"),
    });
    overlayModeController = createOverlayModeController({
      enterNative: (request) => tauri.core.invoke("enter_mini_geometry", { request }),
      updateNative: (request) => tauri.core.invoke("update_mini_geometry", { request }),
      restoreNative: () => tauri.core.invoke("restore_full_geometry"),
      measureContent: modeView.measureContent,
      applyMode: modeView.applyMode,
      setDecorationMode: (mode, geometry) => windowModeControls?.setDisplayMode(mode, geometry),
      reportError: (message) => {
        showLayoutError(message);
        menuStateController?.reportError(message);
      },
    });
    document.getElementById("restoreFullSize")?.addEventListener("click", () => {
      overlayModeController.restoreFull();
    });
    tauri.event
      .listen("enter-mini-mode-requested", () => overlayModeController.enterMini())
      .catch((err) => console.error("Failed to listen enter-mini-mode-requested:", err));
  }
  const config = await loadConfig();
  backgroundAnalytics = createBackgroundAnalytics({
    settings: config?.typingAnalytics,
    context: () => ({
      layout: currentLayoutKey || "unknown",
      language: languageSync?.getState().currentInputSourceId || "unknown",
    }),
    write: (record) => tauriHandle?.core?.invoke("record_typing_analytics", { record }).catch((error) => {
      console.error("Failed to persist typing analytics:", error);
    }),
  });
  globalOverlayHotkey = createGlobalOverlayHotkey({
    hotkey: typeof config?.toggleHotkey === "string" ? config.toggleHotkey : null,
    onToggle: () => tauriHandle?.core?.invoke?.("toggle_window").catch(console.error),
  });
  inputSourceController = createInputSourceController({
    onEvent: (event) => handleNormalizedInputEvent(event),
    onClearSourceState: clearHighlightState,
    onStatusChange: (status) => {
      highlightingStatus = status;
      renderBleKeyboardStatus();
      selfTestBridge?.publishSourceState(status);
    },
  });
  bleHighlightController = createBleHighlightController({
    resolvePosition: (position) => document.querySelector(`.key[data-index="${position}"]`),
    setComboActive: setBleComboActive,
    showPositionLabel: (element, event) => showKeyEvent(
      element.textContent?.trim() || `Position ${event.position}`,
    ),
    reportDiagnostic: ({ code, event }) => showLayoutError(
      code === "unmatched-combo"
        ? `BLE combo ${event.comboId} is not present in the loaded layout.`
        : `BLE position ${event.position} is not present in the loaded layout.`,
    ),
  });
  await loadLayoutDefinitions(config);
  if (Object.keys(layoutDefinitions).length === 0) {
    console.error("No layouts loaded; cannot initialize UI");
    return;
  }
  const allowedLayoutKeys = getAllowedLayoutKeys(config);
  const layoutMenuOptions = allowedLayoutKeys.map((key) => ({
    key,
    label: layoutDefinitions[key]?.name ?? key,
  }));
  currentLayoutKey = pickDefaultLayout(config, allowedLayoutKeys);

  bleRuntime = createOverlayBleRuntime({
    tauri,
    getCurrentLayoutKey: () => currentLayoutKey,
    getBleSource: (layoutKey) => layoutBleSources[layoutKey] ?? null,
    getInputSourceController: () => inputSourceController,
    onLayerChange: (layer) => {
      selfTestBridge?.observeLayer(layer);
      applyLayer(layer);
      languageSync?.setLayer(layer);
    },
    onStatusChange: (status) => {
      if (status.state !== "connected" || !status.writable) {
        selfTestBridge?.reportUnavailable(status.message ?? "Writable BLE layer control is unavailable");
      }
      menuStateController?.handleBleStatus(status);
      if (status.layoutKey === currentLayoutKey) {
        languageSync?.setBleStatus(status.state ?? "idle", Boolean(status.writable));
      }
      if (status.state === "error" && status.message) {
        console.warn("BLE layer sync unavailable:", status.message);
      }
    },
    onDiagnosticMessage: showLayoutError,
    renderBleKeyboardStatus,
  });
  selfTestBridge = createOverlaySelfTestBridge({
    tauri,
    overlayPresentation: selfTestOverlayPresentation,
    getInputSourceSnapshot: () => inputSourceController.getSnapshot(),
    getActiveLayoutKey: () => currentLayoutKey,
    getObservedLayer: () => bleRuntime?.getObservedLayer() ?? null,
    isWritable: () => bleRuntime?.isWritable() ?? false,
    getLayerKeys: (layoutKey) => layoutLayerKeys[layoutKey ?? ""] ?? [],
    writeLayer: (layer, acceptableLayers) => bleRuntime.writeLayer(layer, acceptableLayers),
    setReconciliationSuspended: (suspended) => languageSync?.setSuspended(suspended),
  });

  languageSync = createOverlayLanguageSync({
    platform: runtimePlatform,
    tauri,
    window,
    document,
    getCurrentLayoutKey: () => currentLayoutKey,
    getSyncConfig: (layoutKey) => layoutInputSourceSync[layoutKey] ?? null,
    getBleLayerSync: () => bleRuntime,
    onMenuUpdate: (state) => menuControls?.update(state),
    onSelfTestLeaseInvalidate: (reason) => selfTestBridge?.invalidate(reason),
  });
  languageSync.createAdapter();
  languageSync.installRefreshListeners();

  overlayActions = createOverlayActions({
    window,
    getTauriHandle: () => tauriHandle,
    getCurrentLayoutKey: () => currentLayoutKey,
    setCurrentLayoutKey: (key) => { currentLayoutKey = key; },
    setCurrentLayerIndex: (index) => { currentLayerIndex = index; },
    getLayoutSources: () => layoutSources,
    getLayoutBleSources: () => layoutBleSources,
    getLayouts: () => layouts,
    layoutRegistry,
    syncLayoutState,
    renderKeyboard,
    startLanguageSync,
    getBleRuntime: () => bleRuntime,
    getMenuStateController: () => menuStateController,
    getOverlayModeController: () => overlayModeController,
    getSelfTestBridge: () => selfTestBridge,
    showLayoutError,
  });

  menuStateController = createAppMenuStateController({
    getCurrentLayoutKey: () => currentLayoutKey,
    getCurrentLayoutLabel: (/** @type {string} */ key) => layoutDefinitions[key]?.name ?? key,
    getCurrentLayoutSource: () => layoutSources[currentLayoutKey],
    getCurrentBleSource: () => layoutBleSources[currentLayoutKey] ?? null,
    hasNativeBridge: () => Boolean(tauriHandle?.core?.invoke && tauriHandle?.event?.listen),
    reloadLayout: reloadCurrentLayout,
    reconnectBle: reconnectCurrentBle,
    openTypingInvaders,
    openKeyboardSnake,
    openFlappyKeyBird,
    openUnderwaterTypingFishing,
    openKeyboardSelfTest,
    enterMiniMode,
    openTypingInsights: openTypingInsightsWindow,
    openSettings: openSettingsWindow,
    openHelp: openHelpPage,
    onChange: (/** @type {unknown} */ state) => menuControls?.update(state),
  });

  menuControls = createMenu({
    onLayoutSelect: setLayout,
    onReloadLayout: () => menuStateController.reload(),
    onKeyboardSelfTest: () => menuStateController.selfTest(),
    onReconnectBle: () => menuStateController.reconnect(),
    onMiniMode: () => menuStateController.mini(),
    onStartGame: () => menuStateController.launchGame(),
    onStartSnake: () => menuStateController.launchSnake(),
    onStartFlappy: () => menuStateController.launchFlappy(),
    onStartFishing: () => menuStateController.launchFishing(),
    onInsights: () => menuStateController.insights(),
    onSettings: () => menuStateController.settings(),
    onHelp: () => menuStateController.help(),
    onLanguageSelect: selectLanguage,
    layoutOptions: layoutMenuOptions,
  });
  menuStateController.refresh();

  if (tauri) {
    tauri.core
      .invoke("start_keyboard_listener")
      .catch((err) => console.error("Failed to start listener:", err));

    tauri.event
      .listen("key_event", (e) => {
        const event = normalizeSystemKeyEvent(e.payload);
        if (event) {
          backgroundAnalytics?.handle(event);
          routeSystemKeyEvent(event, {
            hotkeyController: globalOverlayHotkey,
            inputSourceController,
          });
        }
      })
      .catch((err) => console.error("Failed to listen key_event:", err));

    tauri.event
      .listen("typing-exercise-ownership", (event) => {
        const payload = event.payload && typeof event.payload === "object" ? /** @type {{ active?: unknown }} */ (event.payload) : {};
        backgroundAnalytics?.setSuspended(payload.active === true);
      })
      .catch((err) => console.error("Failed to listen typing exercise ownership:", err));
    tauri.event
      .listen("typing-analytics-deleted", () => backgroundAnalytics?.resetTransient())
      .catch((err) => console.error("Failed to listen typing analytics deletion:", err));

    bleRuntime?.installEventListeners();

    selfTestBridge?.installEventListeners();

    tauri.event
      .listen("layout_selected", (e) => {
        const payload = e.payload && typeof e.payload === "object" ? /** @type {{ layout?: unknown }} */ (e.payload) : {};
        const key = payload.layout;
        if (typeof key === "string") {
          setLayout(key);
        }
      })
      .catch((err) => console.error("Failed to listen layout_selected:", err));

    tauri.event
      .listen("app-settings-saved", () => reloadOverlayAfterSettingsSave(window.location))
      .catch((err) => console.error("Failed to listen app-settings-saved:", err));

  } else {
    console.warn("Tauri global API (window.__TAURI__) is not available");
  }

  await setLayout(currentLayoutKey);
  if (layoutLoadErrors.length) {
    showLayoutError(`${layoutLoadErrors[0]} A built-in fallback is active.`);
  }
  if (tauri?.core?.invoke && await tauri.core.invoke("quality_smoke_requested")) {
    await tauri.core.invoke("run_secondary_window_smoke");
  }
});
