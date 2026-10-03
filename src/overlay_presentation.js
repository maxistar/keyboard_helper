import { formatBleKeyboardStatus } from "./ble_status.js";
import { normalizeKeyEntry } from "./layout_catalog.js";
import {
  applyCanvasGeometry,
  calcKeyBounds,
  calcOverlayCanvas,
  COMBO_BORDER_PADDING,
  renderKeyLabel,
} from "./keyboard_renderer.js";

export function createOverlayPresentation({
  document,
  layoutRoot,
  pressedKeyTracker,
  selfTestOverlayPresentation,
  getCurrentLayoutKey,
  getCurrentLayerIndex,
  setCurrentLayerIndex,
  getLayouts,
  getLayoutLayers,
  getLayoutLayerNames,
  getComboDefinitionsByLayout,
  getBleStatus,
  refreshMiniGeometry,
}) {
  let comboBordersByCode = new Map();
  let comboBordersById = new Map();
  let comboBorderEls = [];
  let layerIndicatorEl = null;
  let hudContainer = null;
  let keyEventIndicatorEl = null;
  let keyEventHideTimer = null;
  let layoutErrorEl = null;
  let layoutErrorTimer = null;
  let bleKeyboardStatusEl = null;

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

    const padding = COMBO_BORDER_PADDING;
    const canvas = calcOverlayCanvas(layout.keys, layout.keySize);
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
      border.style.left = `${left - canvas.originX}px`;
      border.style.top = `${top - canvas.originY}px`;
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
    const currentLayoutKey = getCurrentLayoutKey();
    const comboDefinitions = getComboDefinitionsByLayout()[currentLayoutKey] ?? [];
    renderComboBorders(layout, comboDefinitions);

    applyCanvasGeometry(layoutRoot, calcOverlayCanvas(layout.keys, layout.keySize));

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
    refreshMiniGeometry?.();
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
    const { highlightingStatus, bleKeyboardStatus, bleBatteryLevel } = getBleStatus();
    const status = formatBleKeyboardStatus(highlightingStatus, bleKeyboardStatus, bleBatteryLevel);
    bleKeyboardStatusEl.textContent = `${status.summary} · ${status.detail} · ${status.battery}`;
  }

  function renderLayerIndicator() {
    ensureLayerIndicator();
    const currentLayoutKey = getCurrentLayoutKey();
    const currentLayerIndex = getCurrentLayerIndex();
    const totalLayers = getLayoutLayers()[currentLayoutKey]?.length ?? 1;
    const layerNames = getLayoutLayerNames()[currentLayoutKey] ?? [];
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
    const currentLayoutKey = getCurrentLayoutKey();
    const layers = getLayoutLayers()[currentLayoutKey];
    const layout = getLayouts()[currentLayoutKey];
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

    setCurrentLayerIndex(safeIndex);
    renderLayerIndicator();
  }

  function clearComboActivations() {
    comboBorderEls.forEach((element) => element.classList.remove("active"));
  }

  return {
    renderKeyboard,
    showLayoutError,
    showKeyEvent,
    renderBleKeyboardStatus,
    renderLayerIndicator,
    applyLayer,
    setComboActive,
    setBleComboActive,
    clearComboActivations,
  };
}
