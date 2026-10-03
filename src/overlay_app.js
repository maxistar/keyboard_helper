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

const runtimePlatform = detectRuntimePlatform();
const layoutRegistry = createOverlayLayoutRegistry({ runtimePlatform });
let layoutDefinitions = {};
let layouts = {};
let layoutLayers = {};
let layoutLayerNames = {};
let layoutLayerKeys = {};
let layoutSources = {};
let layoutBleSources = {};
let layoutInputSourceSync = {};
let comboDefinitionsByLayout = {};

let layoutLoadErrors = [];
let selfTestBridge = null;

function syncLayoutState() {
  layoutDefinitions = layoutRegistry.layoutDefinitions;
  layoutLayers = layoutRegistry.layoutLayers;
  layoutLayerNames = layoutRegistry.layoutLayerNames;
  layoutLayerKeys = layoutRegistry.layoutLayerKeys;
  layouts = layoutRegistry.layouts;
  layoutSources = layoutRegistry.layoutSources;
  layoutBleSources = layoutRegistry.layoutBleSources;
  layoutInputSourceSync = layoutRegistry.layoutInputSourceSync;
  comboDefinitionsByLayout = layoutRegistry.comboDefinitionsByLayout;
  layoutLoadErrors = layoutRegistry.layoutLoadErrors;
}

async function loadLayoutDefinitions(config) {
  await layoutRegistry.loadLayoutDefinitions(config);
  syncLayoutState();
}

window.addEventListener("pagehide", () => layoutRegistry.dispose(), { once: true });

const layoutRoot = document.getElementById("layoutRoot");
const selfTestOverlayPresentation = createSelfTestOverlayPresentation({ root: layoutRoot });
let currentLayerIndex = 0;
let menuControls = null;
let menuStateController = null;
let overlayModeController = null;
let windowModeControls = null;
let currentLayoutKey = "qwerty";
let overlayActions = null;
let bleRuntime = null;
let languageSync = null;
let tauriHandle = null;
let inputSourceController = null;
let globalOverlayHotkey = null;
let bleHighlightController = null;
let highlightingStatus = null;

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

const renderKeyboard = (layout) => overlayPresentation.renderKeyboard(layout);
const showLayoutError = (message) => overlayPresentation.showLayoutError(message);
const showKeyEvent = (code) => overlayPresentation.showKeyEvent(code);
const renderBleKeyboardStatus = () => overlayPresentation.renderBleKeyboardStatus();
const applyLayer = (index) => overlayPresentation.applyLayer(index);
const setComboActive = (code, active) => overlayPresentation.setComboActive(code, active);
const setBleComboActive = (comboId, active) => overlayPresentation.setBleComboActive(comboId, active);
const inputRouter = createOverlayInputRouter({
  document,
  pressedKeyTracker,
  getBleHighlightController: () => bleHighlightController,
  setComboActive,
  clearComboActivations: () => overlayPresentation.clearComboActivations(),
  showKeyEvent,
});
const handleNormalizedInputEvent = (event) => inputRouter.handleNormalizedInputEvent(event);
const clearHighlightState = () => inputRouter.clearHighlightState();

async function startLanguageSync(layoutKey) {
  return languageSync?.start(layoutKey) ?? false;
}

async function selectLanguage(inputSourceId) {
  return languageSync?.select(inputSourceId) ?? false;
}

function getAllowedLayoutKeys(_config) {
  return layoutRegistry.getAllowedLayoutKeys();
}

function pickDefaultLayout(config, allowedKeys) {
  const preferred = config?.defaultLayout;
  console.log("Preferred layout from config:", preferred);
  return pickAvailableLayout(config, allowedKeys, currentLayoutKey) ?? currentLayoutKey;
}

async function loadConfig() {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return normalizeConfig(null);
  try {
    const result = await tauri.core.invoke("read_config_state");
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


const reloadCurrentLayout = (key) => overlayActions.reloadCurrentLayout(key);
const reconnectCurrentBle = (key) => overlayActions.reconnectCurrentBle(key);
const openHelpPage = (url) => overlayActions.openHelpPage(url);
const openTypingInvaders = () => overlayActions.openTypingInvaders();
const openKeyboardSnake = () => overlayActions.openKeyboardSnake();
const openFlappyKeyBird = () => overlayActions.openFlappyKeyBird();
const openUnderwaterTypingFishing = () => overlayActions.openUnderwaterTypingFishing();
const openTypingInsightsWindow = () => overlayActions.openTypingInsightsWindow();
const openSettingsWindow = () => overlayActions.openSettingsWindow();
const openKeyboardSelfTest = () => overlayActions.openKeyboardSelfTest();
const enterMiniMode = () => overlayActions.enterMiniMode();
const setLayout = (key) => overlayActions.setLayout(key);

window.addEventListener("DOMContentLoaded", async () => {
  const tauri = window.__TAURI__;
  tauriHandle = tauri;
  if (tauri?.core?.invoke && tauri?.event?.listen) {
    let startupGeometry = { decorations: true };
    try {
      startupGeometry = await tauri.core.invoke("restore_full_geometry");
    } catch (error) {
      console.error("Failed to initialize full overlay geometry:", error);
      showLayoutError(error?.message ?? String(error));
    }
    if (typeof window.setupWindowModeToggle === "function") {
      windowModeControls = window.setupWindowModeToggle(tauri);
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
    document.getElementById("restoreFullSize").addEventListener("click", () => {
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
    hotkey: config?.toggleHotkey ?? null,
    onToggle: () => tauriHandle?.core?.invoke("toggle_window").catch(console.error),
  });
  inputSourceController = createInputSourceController({
    onEvent: handleNormalizedInputEvent,
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
        languageSync?.setBleStatus(status.state, status.writable);
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
    getLayerKeys: (layoutKey) => layoutLayerKeys[layoutKey],
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
    getCurrentLayoutLabel: (key) => layoutDefinitions[key]?.name ?? key,
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
    onChange: (state) => menuControls?.update(state),
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
        backgroundAnalytics?.setSuspended(event.payload?.active === true);
      })
      .catch((err) => console.error("Failed to listen typing exercise ownership:", err));
    tauri.event
      .listen("typing-analytics-deleted", () => backgroundAnalytics?.resetTransient())
      .catch((err) => console.error("Failed to listen typing analytics deletion:", err));

    bleRuntime?.installEventListeners();

    selfTestBridge?.installEventListeners();

    tauri.event
      .listen("layout_selected", (e) => {
        const key = e.payload?.layout;
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
