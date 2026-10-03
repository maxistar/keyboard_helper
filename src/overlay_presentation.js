import { formatBleKeyboardStatus } from "./ble_status.js";
import { normalizeKeyEntry } from "./layout_catalog.js";
import {
  applyCanvasGeometry,
  calcKeyBounds,
  calcOverlayCanvas,
  COMBO_BORDER_PADDING,
  renderKeyLabel,
} from "./keyboard_renderer.js";

/**
 * @typedef {import("./key_highlight.js").PressedKeyTracker} PressedKeyTracker
 * @typedef {import("./layout_catalog.js").LayoutModel} LayoutModel
 * @typedef {import("./layout_semantics.js").KeyEntry} KeyEntry
 * @typedef {import("./keyboard_renderer.js").KeySize} KeySize
 * @typedef {{ row: number, col: number }} ComboKeyPosition
 * @typedef {{ key1: ComboKeyPosition, key2: ComboKeyPosition, code: string, id: number | null }} ComboDefinition
 * @typedef {{ refresh(): void }} SelfTestOverlayPresentation
 * @typedef {{ highlightingStatus?: unknown, bleKeyboardStatus?: unknown, bleBatteryLevel?: unknown }} BleStatusSnapshot
 * @typedef {{
 *   document: Document,
 *   layoutRoot: HTMLElement,
 *   pressedKeyTracker: PressedKeyTracker,
 *   selfTestOverlayPresentation: SelfTestOverlayPresentation,
 *   getCurrentLayoutKey: () => string,
 *   getCurrentLayerIndex: () => number,
 *   setCurrentLayerIndex: (index: number) => void,
 *   getLayouts: () => Record<string, LayoutModel>,
 *   getLayoutLayers: () => Record<string, KeyEntry[][]>,
 *   getLayoutLayerNames: () => Record<string, string[]>,
 *   getComboDefinitionsByLayout: () => Record<string, ComboDefinition[]>,
 *   getBleStatus: () => BleStatusSnapshot,
 *   refreshMiniGeometry?: () => void,
 * }} OverlayPresentationOptions
 */

/** @param {OverlayPresentationOptions} options */
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
  /** @type {Map<string, HTMLElement[]>} */
  let comboBordersByCode = new Map();
  /** @type {Map<number, HTMLElement>} */
  let comboBordersById = new Map();
  /** @type {HTMLElement[]} */
  let comboBorderEls = [];
  /** @type {HTMLElement | null} */
  let layerIndicatorEl = null;
  /** @type {HTMLElement | null} */
  let hudContainer = null;
  /** @type {HTMLElement | null} */
  let keyEventIndicatorEl = null;
  /** @type {number | null} */
  let keyEventHideTimer = null;
  /** @type {HTMLElement | null} */
  let layoutErrorEl = null;
  /** @type {number | null} */
  let layoutErrorTimer = null;
  /** @type {HTMLElement | null} */
  let bleKeyboardStatusEl = null;

  /** @param {KeySize} keySize */
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

  /**
   * @param {LayoutModel} layout
   * @param {ComboDefinition[]} comboDefinitions
   */
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
      const bordersForCode = comboBordersByCode.get(combo.code);
      if (bordersForCode) {
        bordersForCode.push(border);
      } else {
        comboBordersByCode.set(combo.code, [border]);
      }
      if (combo.id !== null) comboBordersById.set(combo.id, border);
    });
  }

  /**
   * @param {string} code
   * @param {boolean} active
   */
  function setComboActive(code, active) {
    const borders = comboBordersByCode.get(code);
    if (!borders) return;
    borders.forEach((border) => border.classList.toggle("active", active));
  }

  /**
   * @param {number} comboId
   * @param {boolean} active
   */
  function setBleComboActive(comboId, active) {
    const border = comboBordersById.get(comboId);
    if (!border) return false;
    border.classList.toggle("active", active);
    return true;
  }

  /** @param {LayoutModel} layout */
  function renderKeyboard(layout) {
    layoutRoot.innerHTML = "";
    pressedKeyTracker.clear();

    if (!layout.keySize) return;
    applyKeySizes(layout.keySize);
    const currentLayoutKey = getCurrentLayoutKey();
    const comboDefinitions = getComboDefinitionsByLayout()[currentLayoutKey] ?? [];
    renderComboBorders(layout, comboDefinitions);

    applyCanvasGeometry(layoutRoot, calcOverlayCanvas(layout.keys, layout.keySize));

    layout.keys.forEach((k, key) => {
      const el = document.createElement("div");
      el.className = `key ${k.cls || ""}`.trim();
      renderKeyLabel(el, k);
      el.dataset.index = String(key);
      el.style.setProperty("--row", String(k.row));
      el.style.setProperty("--col", String(k.col));
      if (k.w) el.style.setProperty("--w", String(k.w));
      if (k.h) el.style.setProperty("--h", String(k.h));
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

    const hud = hudContainer;
    if (!hud) return;
    if (!hud.contains(keyEventIndicatorEl)) {
      hud.insertBefore(keyEventIndicatorEl, hud.firstChild);
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
    const hud = hudContainer;
    if (!hud) return;
    if (!hud.contains(layoutErrorEl)) {
      hud.appendChild(layoutErrorEl);
    }
  }

  /** @param {string} message */
  function showLayoutError(message) {
    ensureLayoutError();
    const errorEl = layoutErrorEl;
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.add("visible");
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

  /** @param {string | null | undefined} code */
  function showKeyEvent(code) {
    ensureKeyEventIndicator();
    const indicator = keyEventIndicatorEl;
    if (!indicator) return;
    indicator.textContent = code ?? "";
    indicator.classList.add("visible");
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

    const hud = hudContainer;
    if (!hud) return;
    if (!hud.contains(layerIndicatorEl)) {
      hud.appendChild(layerIndicatorEl);
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
    const hud = hudContainer;
    if (!hud) return;
    if (!hud.contains(bleKeyboardStatusEl)) hud.appendChild(bleKeyboardStatusEl);
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
    const layerIndicator = layerIndicatorEl;
    if (!layerIndicator) return;
    layerIndicator.innerHTML = "";

    const activeName = layerNames[currentLayerIndex] ?? `Layer ${currentLayerIndex + 1}`;
    const nameEl = document.createElement("span");
    nameEl.className = "layer-name";
    nameEl.textContent = activeName;
    layerIndicator.appendChild(nameEl);

    const dotsWrapper = document.createElement("div");
    dotsWrapper.className = "layer-dots";

    for (let i = 0; i < totalLayers; i++) {
      const dot = document.createElement("span");
      dot.className = "layer-dot";
      if (i === currentLayerIndex) {
        dot.classList.add("active");
      }
      dot.dataset.index = String(i);
      dot.title = `Layer ${i + 1}`;
      dot.addEventListener("click", () => applyLayer(i));
      dotsWrapper.appendChild(dot);
    }

    layerIndicator.appendChild(dotsWrapper);
  }

  /** @param {number} index */
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
