import { createMenu } from "./menu.js";
import { createAppMenuStateController } from "./app_menu_state.js";
import { reloadActiveExternalLayout } from "./app_menu_actions.js";
import {
  createBleLayerSyncController,
  normalizeBleLayerSource,
} from "./ble_layer_sync.js";
import { createPressedKeyTracker, resolveKeyElement } from "./key_highlight.js";
import { normalizeBleKeyboardFrame, normalizeSystemKeyEvent } from "./input_events.js";
import { createInputSourceController } from "./input_source_controller.js";
import { createBleHighlightController } from "./ble_highlight.js";
import { createGlobalOverlayHotkey } from "./global_overlay_hotkey.js";
import { routeSystemKeyEvent } from "./system_key_event_router.js";
import { formatBleKeyboardStatus } from "./ble_status.js";
import { BUILTIN_LAYOUT_FILES, normalizeConfig, pickAvailableLayout } from "./app_config.js";
import { reloadOverlayAfterSettingsSave } from "./settings_runtime.js";
import {
  createOverlayModeController,
  createOverlayModeView,
} from "./overlay_mode.js";
import { buildLayout, normalizeKeyEntry, normalizeLayerData } from "./layout_catalog.js";
import { normalizeInputSourceSync } from "./input_source_sync_config.js";
import { createMacosInputSourceController } from "./macos_input_source.js";
import { createInputSourceLayerReconciler } from "./input_source_layer_reconciler.js";
import { calcBounds, calcKeyBounds, renderKeyLabel } from "./keyboard_renderer.js";
import { createSelfTestOverlayPresentation } from "./self_test/overlay_presentation.js";
import { createSelfTestLayerLeaseCoordinator } from "./self_test/layer_lease.js";

const builtinLayoutFiles = BUILTIN_LAYOUT_FILES;
let layoutDefinitions = {};
let normalizedLayoutLayers = {};
let layouts = {};
let layoutLayers = {};
let layoutLayerNames = {};
let layoutLayerKeys = {};
let layoutLayerMetadata = {};
let layoutSources = {};
let layoutBleSources = {};
let layoutInputSourceSync = {};
let comboDefinitionsByLayout = {};
let comboBordersByCode = new Map();
let comboBordersById = new Map();
let comboBorderEls = [];
let layoutLoadErrors = [];
let selfTestSourceStateSubscribed = false;
let selfTestLayerLease = null;
let observedBleLayer = null;
let bleLayerControlStatus = { state: "idle", writable: false };

function publishSelfTestSourceState(status) {
  if (!selfTestSourceStateSubscribed || !window.__TAURI__?.event?.emitTo) return;
  window.__TAURI__.event
    .emitTo("keyboard-self-test", "self-test-source-state", status)
    .catch(() => { selfTestSourceStateSubscribed = false; });
}

function publishSelfTestLayerLeaseStatus(status) {
  if (!window.__TAURI__?.event?.emitTo) return;
  window.__TAURI__.event
    .emitTo("keyboard-self-test", "self-test-layer-lease-status", status)
    .catch(() => {});
}

async function loadLayoutDefinition(key, source) {
  // source: true (builtin) or string path
  if (source === true) {
    const fileName = builtinLayoutFiles[key];
    if (!fileName) {
      const error = `No builtin layout file mapped for key ${key}`;
      console.warn(error);
      return { def: null, error };
    }
    try {
      const resp = await fetch(fileName);
      if (!resp.ok) {
        const error = `Failed to load ${fileName}: ${resp.status}`;
        console.warn(error);
        return { def: null, error };
      }
      return { def: await resp.json(), error: null };
    } catch (err) {
      const error = `Failed to parse ${fileName}`;
      console.warn(error, err);
      return { def: null, error };
    }
  }

  if (typeof source === "string") {
    const tauri = window.__TAURI__;
    if (!tauri?.core?.invoke) {
      const error = "Tauri API unavailable; cannot load external layout";
      console.warn(`${error}:`, key);
      return { def: null, error };
    }
    try {
      const raw = await tauri.core.invoke("read_layout_file", { path: source });
      if (typeof raw !== "string") {
        const error = `External layout for ${key} did not return string content`;
        console.warn(error);
        return { def: null, error };
      }
      return { def: JSON.parse(raw), error: null };
    } catch (err) {
      const message = err?.message ?? String(err);
      const error = `Failed to load external layout for ${key} from ${source}: ${message}`;
      console.warn(error, err);
      return { def: null, error };
    }
  }

  return { def: null, error: null };
}

async function loadLayoutDefinitions(config) {
  const entries = [];
  layoutLoadErrors = [];
  const layoutConfig = config?.layouts;
  layoutSources = {};
  if (layoutConfig && typeof layoutConfig === "object") {
    for (const [key, source] of Object.entries(layoutConfig)) {
      layoutSources[key] = source;
      const { def, error } = await loadLayoutDefinition(key, source);
      if (def) entries.push([key, def]);
      else if (error) layoutLoadErrors.push(error);
    }
  } else {
    // fallback: load all built-in layouts
    for (const [key, fileName] of Object.entries(builtinLayoutFiles)) {
      if (!fileName) continue;
      layoutSources[key] = true;
      const { def } = await loadLayoutDefinition(key, true);
      if (def) entries.push([key, def]);
    }
  }

  if (entries.length === 0) {
    for (const key of Object.keys(builtinLayoutFiles)) {
      layoutSources[key] = true;
      const { def, error } = await loadLayoutDefinition(key, true);
      if (def) entries.push([key, def]);
      else if (error) layoutLoadErrors.push(error);
    }
  }

  layoutDefinitions = Object.fromEntries(entries);
  rebuildLayoutData();
}

function rebuildLayoutData() {
  normalizedLayoutLayers = {};
  layoutLayerNames = {};
  layoutLayerKeys = {};
  layoutLayerMetadata = {};
  layouts = {};
  layoutBleSources = {};
  layoutInputSourceSync = {};
  comboDefinitionsByLayout = {};

  for (const [key, def] of Object.entries(layoutDefinitions)) {
    const { layers, names, layerKeys, layerMetadata } = normalizeLayerData(
      def.keyLayers,
      def.layerMetadata,
      def.keyPositions?.length,
    );
    normalizedLayoutLayers[key] = layers;
    layoutLayerNames[key] = names;
    layoutLayerKeys[key] = layerKeys;
    layoutLayerMetadata[key] = layerMetadata;
    layouts[key] = buildLayout(def, layers);
    layoutBleSources[key] = normalizeBleLayerSource(def);
    const inputSourceSync = normalizeInputSourceSync(def, layers.length);
    layoutInputSourceSync[key] = inputSourceSync.config;
    if (inputSourceSync.error) {
      layoutLoadErrors.push(`${def.name ?? key}: ${inputSourceSync.error}`);
    }
    if (Array.isArray(def.combos)) {
      comboDefinitionsByLayout[key] = def.combos
        .map((combo) => normalizeCombo(combo, def.keyPositions))
        .filter(Boolean);
    }
  }

  layoutLayers = normalizedLayoutLayers;
}

const layoutRoot = document.getElementById("layoutRoot");
const selfTestOverlayPresentation = createSelfTestOverlayPresentation({ root: layoutRoot });
let currentLayerIndex = 0;
let layerIndicatorEl = null;
let hudContainer = null;
let keyEventIndicatorEl = null;
let keyEventHideTimer = null;
let layoutErrorEl = null;
let layoutErrorTimer = null;
let bleKeyboardStatusEl = null;
let menuControls = null;
let menuStateController = null;
let overlayModeController = null;
let windowModeControls = null;
let currentLayoutKey = "qwerty";
let bleLayerSync = null;
let macosInputSource = null;
let sourceLayerReconciler = null;
let languageMenuState = {
  languageAvailable: false,
  languageOptions: [],
  currentInputSourceId: null,
  languageStatus: "waiting",
  languageStatusLabel: "Waiting for keyboard",
  languageMessage: null,
  languagePendingId: null,
};
let shiftHeld = false;
let altGrHeld = false;
let tauriHandle = null;
let inputSourceController = null;
let globalOverlayHotkey = null;
let bleHighlightController = null;
let highlightingStatus = null;
let bleKeyboardStatus = null;
let bleBatteryLevel = null;
const pressedKeyTracker = createPressedKeyTracker();

function languageStatusLabel(status) {
  if (status === "synced") return "Synced";
  if (["settling", "synchronizing", "waiting-confirmation"].includes(status)) {
    return "Synchronizing";
  }
  if (["waiting", "waiting-keyboard", "deferred"].includes(status)) {
    return "Waiting for keyboard";
  }
  if (["offline", "read-only"].includes(status)) return "Offline";
  if (status === "unsupported-source") return "Unavailable source";
  if (status === "unmapped-layer") return "Layer mismatch";
  if (status === "error") return "Synchronization error";
  return "Waiting for keyboard";
}

function updateLanguageMenu(patch) {
  languageMenuState = { ...languageMenuState, ...patch };
  menuControls?.update(languageMenuState);
}

function configuredLanguageOptions(config, availableIds = new Set()) {
  return (config?.sources ?? []).map((source) => ({
    id: source.id,
    label: source.label,
    inputSourceId: source.inputSourceId,
    available: availableIds.has(source.inputSourceId),
  }));
}

async function startLanguageSync(layoutKey) {
  sourceLayerReconciler?.dispose();
  sourceLayerReconciler = null;
  const syncConfig = layoutInputSourceSync[layoutKey] ?? null;
  if (!syncConfig || !macosInputSource || !bleLayerSync) {
    await macosInputSource?.stop();
    updateLanguageMenu({
      languageAvailable: false,
      languageOptions: [],
      currentInputSourceId: null,
      languageStatus: "waiting",
      languageStatusLabel: "Waiting for keyboard",
      languageMessage: null,
      languagePendingId: null,
    });
    return false;
  }

  sourceLayerReconciler = createInputSourceLayerReconciler({
    config: syncConfig,
    settleMs: syncConfig.settleMs,
    writeLayer: (layer, acceptableLayers) => bleLayerSync.writeLayer(layer, acceptableLayers),
    onStateChange: (syncState) => updateLanguageMenu({
      languageStatus: syncState.status,
      languageStatusLabel: languageStatusLabel(syncState.status),
      languageMessage: syncState.message,
    }),
  });
  updateLanguageMenu({
    languageAvailable: true,
    languageOptions: configuredLanguageOptions(syncConfig),
    currentInputSourceId: null,
    languageStatus: "waiting",
    languageStatusLabel: "Waiting for keyboard",
    languageMessage: null,
    languagePendingId: null,
  });
  const started = await macosInputSource.start(layoutKey, syncConfig);
  if (!started && currentLayoutKey === layoutKey) {
    updateLanguageMenu({
      languageStatus: "error",
      languageStatusLabel: "Synchronization error",
    });
  }
  return started;
}

async function selectLanguage(inputSourceId) {
  if (!macosInputSource || languageMenuState.languagePendingId) return false;
  updateLanguageMenu({ languagePendingId: inputSourceId, languageMessage: null });
  selfTestLayerLease?.invalidate("input-source-selected");
  try {
    await macosInputSource.select(inputSourceId);
    return true;
  } catch (error) {
    updateLanguageMenu({
      languageStatus: "error",
      languageStatusLabel: "Synchronization error",
      languageMessage: error?.message ?? String(error),
    });
    return false;
  } finally {
    updateLanguageMenu({ languagePendingId: null });
  }
}

function getAllowedLayoutKeys(_config) {
  const availableKeys = Object.keys(layoutDefinitions);
  return availableKeys;
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

function normalizeCombo(combo, keyPositions = []) {
  if (!combo || typeof combo !== "object") return null;
  const positions = Array.isArray(combo.positions) ? combo.positions : null;
  const key1 = combo.key1 ?? (Number.isInteger(positions?.[0]) ? keyPositions[positions[0]] : null);
  const key2 = combo.key2 ?? (Number.isInteger(positions?.[1]) ? keyPositions[positions[1]] : null);
  const { code } = combo;
  if (!key1 || !key2 || !code) return null;
  if (typeof key1.row !== "number" || typeof key1.col !== "number") return null;
  if (typeof key2.row !== "number" || typeof key2.col !== "number") return null;
  return {
    key1,
    key2,
    code: String(code),
    id: Number.isInteger(combo.id) && combo.id > 0 ? combo.id : null,
    positions: positions ? [...positions] : null,
  };
}

function applyKeySizes({ w, h, gap }) {
  const root = document.documentElement;
  root.style.setProperty("--key-w", `${w}px`);
  root.style.setProperty("--key-h", `${h}px`);
  root.style.setProperty("--gap", `${gap}px`);
}

function clearComboBorders() {
  comboBordersByCode.clear();
  comboBordersById.clear();
  comboBorderEls.forEach((el) => el.remove());
  comboBorderEls = [];
}

function renderComboBorders(layout, comboDefinitions) {
  clearComboBorders();
  if (!comboDefinitions.length) return;

  const positionIndex = new Map();
  layout.keys.forEach((key) => {
    positionIndex.set(`${key.row},${key.col}`, key);
  });

  const padding = 4;
  comboDefinitions.forEach((combo) => {
    const key1 = positionIndex.get(`${combo.key1.row},${combo.key1.col}`);
    const key2 = positionIndex.get(`${combo.key2.row},${combo.key2.col}`);
    if (!key1 || !key2) return;

    const bounds1 = calcKeyBounds(key1, layout.keySize);
    const bounds2 = calcKeyBounds(key2, layout.keySize);
    const left = Math.min(bounds1.left, bounds2.left) - padding;
    const top = Math.min(bounds1.top, bounds2.top) - padding;
    const right = Math.max(bounds1.left + bounds1.width, bounds2.left + bounds2.width) + padding;
    const bottom = Math.max(bounds1.top + bounds1.height, bounds2.top + bounds2.height) + padding;

    const border = document.createElement("div");
    border.className = "combo-border";
    border.dataset.comboCode = combo.code;
    border.style.left = `${left}px`;
    border.style.top = `${top}px`;
    border.style.width = `${right - left}px`;
    border.style.height = `${bottom - top}px`;
    layoutRoot.appendChild(border);

    comboBorderEls.push(border);
    if (!comboBordersByCode.has(combo.code)) {
      comboBordersByCode.set(combo.code, []);
    }
    comboBordersByCode.get(combo.code).push(border);
    if (combo.id !== null) comboBordersById.set(combo.id, border);
  });
}

function setComboActive(code, active) {
  const borders = comboBordersByCode.get(code);
  if (!borders) return;
  borders.forEach((border) => border.classList.toggle("active", active));
}

function setBleComboActive(comboId, active) {
  const border = comboBordersById.get(comboId);
  if (!border) return false;
  border.classList.toggle("active", active);
  return true;
}

function renderKeyboard(layout) {
  layoutRoot.innerHTML = "";
  pressedKeyTracker.clear();

  applyKeySizes(layout.keySize);
  const comboDefinitions = comboDefinitionsByLayout[currentLayoutKey] ?? [];
  renderComboBorders(layout, comboDefinitions);

  const { w, h, gap } = layout.keySize;
  const { maxCol, maxRow } = calcBounds(layout.keys);
  const widthPx = maxCol * (w + gap) + w;
  const heightPx = maxRow * (h + gap) + h;
  layoutRoot.style.width = `${widthPx}px`;
  layoutRoot.style.height = `${heightPx}px`;

  layout.keys.forEach((k, key) => {
    const el = document.createElement("div");
    el.className = `key ${k.cls || ""}`.trim();
    renderKeyLabel(el, k);
    el.dataset.index = key;
    el.style.setProperty("--row", k.row);
    el.style.setProperty("--col", k.col);
    if (k.w) el.style.setProperty("--w", k.w);
    if (k.h) el.style.setProperty("--h", k.h);
    if (typeof k.angle === "number") {
      el.style.setProperty("--angle", `${k.angle}deg`);
    }
    layoutRoot.appendChild(el);
  });

  renderLayerIndicator();
  selfTestOverlayPresentation.refresh();
  overlayModeController?.refreshMiniGeometry();
}

function ensureHudContainer() {
  if (!hudContainer) {
    hudContainer = document.createElement("div");
    hudContainer.className = "hud";
  }

  if (!document.body.contains(hudContainer)) {
    document.body.appendChild(hudContainer);
  }
}

function ensureKeyEventIndicator() {
  ensureHudContainer();
  if (!keyEventIndicatorEl) {
    keyEventIndicatorEl = document.createElement("div");
    keyEventIndicatorEl.className = "key-event-indicator";
  }

  if (!hudContainer.contains(keyEventIndicatorEl)) {
    hudContainer.insertBefore(keyEventIndicatorEl, hudContainer.firstChild);
  }
}

function ensureLayoutError() {
  ensureHudContainer();
  if (!layoutErrorEl) {
    layoutErrorEl = document.createElement("div");
    layoutErrorEl.className = "layout-error";
    layoutErrorEl.setAttribute("role", "alert");
    layoutErrorEl.setAttribute("aria-live", "assertive");
  }
  if (!hudContainer.contains(layoutErrorEl)) {
    hudContainer.appendChild(layoutErrorEl);
  }
}

function showLayoutError(message) {
  ensureLayoutError();
  layoutErrorEl.textContent = message;
  layoutErrorEl.classList.add("visible");
  if (layoutErrorTimer) {
    clearTimeout(layoutErrorTimer);
  }
  layoutErrorTimer = setTimeout(() => {
    if (layoutErrorEl) {
      layoutErrorEl.classList.remove("visible");
      layoutErrorEl.textContent = "";
    }
    layoutErrorTimer = null;
  }, 4000);
}

function showKeyEvent(code) {
  ensureKeyEventIndicator();
  keyEventIndicatorEl.textContent = code ?? "";
  keyEventIndicatorEl.classList.add("visible");
  if (keyEventHideTimer) {
    clearTimeout(keyEventHideTimer);
  }
  keyEventHideTimer = setTimeout(() => {
    if (keyEventIndicatorEl) {
      keyEventIndicatorEl.classList.remove("visible");
      keyEventIndicatorEl.textContent = "";
    }
    keyEventHideTimer = null;
  }, 3000);
}

function ensureLayerIndicator() {
  ensureHudContainer();
  if (!layerIndicatorEl) {
    layerIndicatorEl = document.createElement("div");
    layerIndicatorEl.id = "layerIndicator";
    layerIndicatorEl.className = "layers-indicator";
  }

  if (!hudContainer.contains(layerIndicatorEl)) {
    hudContainer.appendChild(layerIndicatorEl);
  }
}

function renderBleKeyboardStatus() {
  ensureHudContainer();
  if (!bleKeyboardStatusEl) {
    bleKeyboardStatusEl = document.createElement("div");
    bleKeyboardStatusEl.className = "ble-keyboard-status";
    bleKeyboardStatusEl.setAttribute("role", "status");
    bleKeyboardStatusEl.setAttribute("aria-live", "polite");
  }
  if (!hudContainer.contains(bleKeyboardStatusEl)) hudContainer.appendChild(bleKeyboardStatusEl);
  const status = formatBleKeyboardStatus(highlightingStatus, bleKeyboardStatus, bleBatteryLevel);
  bleKeyboardStatusEl.textContent = `${status.summary} · ${status.detail} · ${status.battery}`;
}

function renderLayerIndicator() {
  ensureLayerIndicator();
  const totalLayers = layoutLayers[currentLayoutKey]?.length ?? 1;
  const layerNames = layoutLayerNames[currentLayoutKey] ?? [];
  layerIndicatorEl.innerHTML = "";

  const activeName = layerNames[currentLayerIndex] ?? `Layer ${currentLayerIndex + 1}`;
  const nameEl = document.createElement("span");
  nameEl.className = "layer-name";
  nameEl.textContent = activeName;
  layerIndicatorEl.appendChild(nameEl);

  const dotsWrapper = document.createElement("div");
  dotsWrapper.className = "layer-dots";

  for (let i = 0; i < totalLayers; i++) {
    const dot = document.createElement("span");
    dot.className = "layer-dot";
    if (i === currentLayerIndex) {
      dot.classList.add("active");
    }
    dot.dataset.index = i;
    dot.title = `Layer ${i + 1}`;
    dot.addEventListener("click", () => applyLayer(i));
    dotsWrapper.appendChild(dot);
  }

  layerIndicatorEl.appendChild(dotsWrapper);
}

function applyLayer(index) {
  const layers = layoutLayers[currentLayoutKey];
  const layout = layouts[currentLayoutKey];
  if (!layers || !layout) return;

  const safeIndex = Math.max(0, Math.min(index, layers.length - 1));
  const targetLayer = layers[safeIndex] ?? layers[0];
  const baseLayer = layers[0];

  layout.keys.forEach((k, keyIndex) => {
    const targetKey = targetLayer[keyIndex] ?? baseLayer[keyIndex];
    if (!targetKey) return;
    const el = document.querySelector(`.key[data-index="${keyIndex}"]`);
    if (!el) return;
    const normalized = normalizeKeyEntry(targetKey);
    const baseNormalized = normalizeKeyEntry(baseLayer[keyIndex]);
    const code = normalized.code ?? baseNormalized.code;
    renderKeyLabel(el, { label: normalized.label, code });
  });

  currentLayerIndex = safeIndex;
  renderLayerIndicator();
}

function handleKey(code, type) {
  const wasShiftHeld = shiftHeld;
  const wasAltGrHeld = altGrHeld;

  if (type === "down") {
    setComboActive(code, true);
    if (code === "ShiftLeft" || code === "ShiftRight") shiftHeld = true;
    if (code === "AltGr") altGrHeld = true;
  } else if (type === "up") {
    setComboActive(code, false);
    if (code === "ShiftLeft" || code === "ShiftRight") shiftHeld = false;
    if (code === "AltGr") altGrHeld = false;
  }

  console.log(`Key ${code} ${type}`);
  if (type === "down") {
    const el = resolveKeyElement(document, code, wasShiftHeld, wasAltGrHeld);
    if (!el) return;
    showKeyEvent(code);
    el.classList.add("pressed");
    pressedKeyTracker.remember(code, el);
  } else if (type === "up") {
    const el = pressedKeyTracker.release(
      code,
      resolveKeyElement(document, code, wasShiftHeld, wasAltGrHeld),
    );
    if (!el) return;
    el.classList.remove("pressed");
  }
}

function clearHighlightState() {
  bleHighlightController?.clear();
  document.querySelectorAll(".key.pressed").forEach((element) => element.classList.remove("pressed"));
  comboBorderEls.forEach((element) => element.classList.remove("active"));
  pressedKeyTracker.clear();
  shiftHeld = false;
  altGrHeld = false;
}

function handleNormalizedInputEvent(event) {
  if (event.kind === "key" && event.source === "system") handleKey(event.code, event.action);
  else if (event.source === "ble") bleHighlightController?.handleEvent(event);
}

async function refreshExternalLayout(key) {
  const source = layoutSources[key];
  if (typeof source !== "string") return { ok: true, error: null };
  const { def, error } = await loadLayoutDefinition(key, source);
  if (!def) {
    return { ok: false, error: error ?? `Failed to reload layout "${key}".` };
  }
  layoutDefinitions = { ...layoutDefinitions, [key]: def };
  rebuildLayoutData();
  return { ok: true, error: null };
}

async function reloadCurrentLayout(key) {
  selfTestLayerLease?.invalidate("layout-reloaded");
  return reloadActiveExternalLayout({
    key,
    getCurrentLayoutKey: () => currentLayoutKey,
    getLayoutSource: (layoutKey) => layoutSources[layoutKey],
    loadLayoutDefinition,
    applyLayoutDefinition: (layoutKey, definition) => {
      layoutDefinitions = { ...layoutDefinitions, [layoutKey]: definition };
      rebuildLayoutData();
    },
    renderBaseLayout: (layoutKey) => {
      currentLayerIndex = 0;
      renderKeyboard(layouts[layoutKey]);
    },
    restartBle: async (layoutKey) => {
      await startLanguageSync(layoutKey);
      if (bleLayerSync) {
        await bleLayerSync.start(layoutKey, layoutBleSources[layoutKey] ?? null);
      }
      menuStateController?.refresh();
    },
  });
}

async function reconnectCurrentBle(key) {
  if (key !== currentLayoutKey || !bleLayerSync || !layoutBleSources[key]) return false;
  return bleLayerSync.start(key, layoutBleSources[key]);
}

async function openHelpPage(url) {
  if (tauriHandle) {
    if (typeof tauriHandle.opener?.openUrl !== "function") {
      throw new Error("The system browser opener is unavailable.");
    }
    await tauriHandle.opener.openUrl(url);
    return true;
  }

  if (typeof window.open !== "function") {
    throw new Error("The browser cannot open the Help page.");
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

async function openTypingInvaders() {
  if (!tauriHandle?.core?.invoke) {
    throw new Error("Shift-Space Invaders requires the desktop application.");
  }
  await tauriHandle.core.invoke("open_typing_invaders");
  return true;
}

async function openSettingsWindow() {
  if (!tauriHandle?.core?.invoke) {
    throw new Error("Settings require the desktop application.");
  }
  await tauriHandle.core.invoke("open_settings");
  return true;
}

async function openKeyboardSelfTest() {
  if (!tauriHandle?.core?.invoke) {
    throw new Error("Keyboard Self-test requires the desktop application.");
  }
  await tauriHandle.core.invoke("open_keyboard_self_test", { currentLayout: currentLayoutKey });
  return true;
}

async function enterMiniMode() {
  if (!overlayModeController) {
    throw new Error("Mini Mode is not ready yet.");
  }
  return overlayModeController.enterMini();
}

async function setLayout(key) {
  if (key !== currentLayoutKey) selfTestLayerLease?.invalidate("layout-changed");
  const previousKey = currentLayoutKey;
  const { ok, error } = await refreshExternalLayout(key);
  if (!ok) {
    currentLayoutKey = previousKey;
    showLayoutError(error);
    menuStateController?.reportError(error);
    return false;
  }
  const layout = layouts[key];
  if (!layout) return false;
  currentLayoutKey = key;
  currentLayerIndex = 0;
  renderKeyboard(layout);
  menuStateController?.setActiveLayout();

  await startLanguageSync(key);
  if (bleLayerSync) {
    await bleLayerSync.start(key, layoutBleSources[key] ?? null);
  }

  menuStateController?.refresh();
  return true;
}

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
      publishSelfTestSourceState(status);
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

  bleLayerSync = createBleLayerSyncController({
    tauri,
    onLayerChange: (layer) => {
      observedBleLayer = layer;
      selfTestLayerLease?.observeLayer(layer);
      applyLayer(layer);
      sourceLayerReconciler?.setLayer(layer);
    },
    onStatusChange: (status) => {
      bleLayerControlStatus = { state: status.state, writable: Boolean(status.writable) };
      if (status.state !== "connected") observedBleLayer = null;
      if (status.state !== "connected" || !status.writable) {
        selfTestLayerLease?.reportUnavailable(status.message ?? "Writable BLE layer control is unavailable");
      }
      menuStateController?.handleBleStatus(status);
      if (status.layoutKey === currentLayoutKey) {
        sourceLayerReconciler?.setBleStatus(status.state, status.writable);
      }
      if (status.state === "error" && status.message) {
        console.warn("BLE layer sync unavailable:", status.message);
      }
    },
  });
  selfTestLayerLease = createSelfTestLayerLeaseCoordinator({
    getActiveLayoutKey: () => currentLayoutKey,
    getObservedLayer: () => observedBleLayer,
    isWritable: () => bleLayerControlStatus.state === "connected"
      && bleLayerControlStatus.writable
      && bleLayerSync?.getActiveLayoutKey() === currentLayoutKey,
    validateLayerRequest: (request) => {
      const layerIndex = layoutLayerKeys[currentLayoutKey]?.indexOf(request.layerKey) ?? -1;
      return layerIndex >= 0
        && layoutLayerMetadata[currentLayoutKey]?.[layerIndex]?.firmwareLayerIndex
          === request.firmwareLayerIndex;
    },
    writeLayer: (layer, acceptableLayers) => bleLayerSync.writeLayer(layer, acceptableLayers),
    setReconciliationSuspended: (suspended) => sourceLayerReconciler?.setSuspended(suspended),
    onStatus: publishSelfTestLayerLeaseStatus,
  });

  if (tauri?.core?.invoke && tauri?.event?.listen) {
    macosInputSource = createMacosInputSourceController({
      tauri,
      onSourceChange: (sourceId) => {
        updateLanguageMenu({ currentInputSourceId: sourceId });
        sourceLayerReconciler?.setSource(sourceId);
      },
      onAvailabilityChange: (availableIds) => {
        const syncConfig = layoutInputSourceSync[currentLayoutKey];
        updateLanguageMenu({
          languageOptions: configuredLanguageOptions(syncConfig, availableIds),
        });
      },
      onError: (error) => updateLanguageMenu({
        languageStatus: "error",
        languageStatusLabel: "Synchronization error",
        languageMessage: error?.message ?? String(error),
      }),
    });
    const refreshLanguageSync = () => {
      macosInputSource?.refresh().then(() => sourceLayerReconciler?.resume());
    };
    window.addEventListener("focus", refreshLanguageSync);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshLanguageSync();
    });
  }

  menuStateController = createAppMenuStateController({
    getCurrentLayoutKey: () => currentLayoutKey,
    getCurrentLayoutLabel: (key) => layoutDefinitions[key]?.name ?? key,
    getCurrentLayoutSource: () => layoutSources[currentLayoutKey],
    getCurrentBleSource: () => layoutBleSources[currentLayoutKey] ?? null,
    hasNativeBridge: () => Boolean(tauriHandle?.core?.invoke && tauriHandle?.event?.listen),
    reloadLayout: reloadCurrentLayout,
    reconnectBle: reconnectCurrentBle,
    openTypingInvaders,
    openKeyboardSelfTest,
    enterMiniMode,
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
          routeSystemKeyEvent(event, {
            hotkeyController: globalOverlayHotkey,
            inputSourceController,
          });
        }
      })
      .catch((err) => console.error("Failed to listen key_event:", err));

    tauri.event
      .listen("ble_keyboard_status", (event) => {
        const payload = event.payload ?? {};
        if (payload.layout !== currentLayoutKey) return;
        bleKeyboardStatus = payload;
        renderBleKeyboardStatus();
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
        if (payload.layout !== currentLayoutKey) return;
        const normalized = normalizeBleKeyboardFrame(payload.frame);
        if (normalized) inputSourceController.handleEvent(normalized);
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_event:", err));

    tauri.event
      .listen("ble_keyboard_diagnostic", (event) => {
        const payload = event.payload ?? {};
        if (payload.layout !== currentLayoutKey) return;
        if (payload.code === "sequence-gap") inputSourceController.reportSequenceGap();
        if (payload.message) showLayoutError(payload.message);
      })
      .catch((err) => console.error("Failed to listen ble_keyboard_diagnostic:", err));

    tauri.event
      .listen("ble_battery_update", (event) => {
        const payload = event.payload ?? {};
        if (payload.layout !== currentLayoutKey) return;
        bleBatteryLevel = Number.isInteger(payload.level) && payload.level >= 0 && payload.level <= 100
          ? payload.level
          : null;
        renderBleKeyboardStatus();
      })
      .catch((err) => console.error("Failed to listen ble_battery_update:", err));

    tauri.event
      .listen("self-test-overlay-state", (event) => {
        selfTestOverlayPresentation.update(event.payload);
      })
      .catch((err) => console.error("Failed to listen self-test-overlay-state:", err));

    tauri.event
      .listen("self-test-source-request", () => {
        selfTestSourceStateSubscribed = true;
        publishSelfTestSourceState(inputSourceController.getSnapshot());
      })
      .catch((err) => console.error("Failed to listen self-test-source-request:", err));

    tauri.event
      .listen("self-test-layer-lease-request", (event) => {
        selfTestLayerLease.acquire(event.payload ?? {});
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-request:", err));

    tauri.event
      .listen("self-test-layer-lease-reassert", (event) => {
        selfTestLayerLease.reassert(event.payload?.generation);
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-reassert:", err));

    tauri.event
      .listen("self-test-layer-lease-release", (event) => {
        selfTestLayerLease.release(event.payload?.generation);
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-release:", err));

    tauri.event
      .listen("self-test-layer-lease-manual", (event) => {
        selfTestLayerLease.invalidateGeneration(event.payload?.generation, "manual-continuation");
      })
      .catch((err) => console.error("Failed to listen self-test-layer-lease-manual:", err));

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
