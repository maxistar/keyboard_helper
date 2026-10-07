import { calcCanvasGeometry } from "./layout_geometry.js";

const VIEWER_TAG = "keyboard-layout-viewer";
const KEY_SELECTOR = ".key[data-index], .viewer-key[data-position]";
const VIEWER_STYLES = `
.keyboard-layout-viewer { display: block; position: relative; }
.keyboard-layout-viewer .key, .keyboard-layout-viewer .viewer-key {
  position: absolute; display: flex; align-items: center; justify-content: center;
  transform: rotate(var(--angle, var(--viewer-angle, 0deg))); transform-origin: center;
}
.keyboard-layout-viewer .viewer-key {
  left: calc(var(--viewer-col) * (var(--viewer-key-width) + var(--viewer-key-gap)) - var(--viewer-origin-x, 0px));
  top: calc(var(--viewer-row) * (var(--viewer-key-height) + var(--viewer-key-gap)) - var(--viewer-origin-y, 0px));
  width: calc(var(--viewer-key-width) * var(--viewer-width, 1) + var(--viewer-key-gap) * (var(--viewer-width, 1) - 1));
  height: calc(var(--viewer-key-height) * var(--viewer-height, 1) + var(--viewer-key-gap) * (var(--viewer-height, 1) - 1));
  padding: 4px; overflow: hidden; border: 1px solid rgb(148 163 184 / 42%);
  border-radius: 9px; background: linear-gradient(#263449, #172033);
  box-shadow: inset 0 -3px 0 rgb(2 6 23 / 55%), 0 3px 7px rgb(0 0 0 / 25%);
  color: #f8fafc; font-size: 0.76rem; font-weight: 650; line-height: 1.05;
  text-align: center; overflow-wrap: anywhere;
}
.keyboard-layout-viewer .viewer-key.action { background: linear-gradient(#334155, #1e293b); }
.keyboard-layout-viewer .viewer-key-legend { font-size: 1.4em; }
.keyboard-layout-viewer .viewer-key-state {
  position: absolute; inset: auto 3px 3px; padding: 2px 3px; border-radius: 3px;
  background: #020617; color: #fff; font-size: 0.48rem; font-weight: 800; letter-spacing: 0.04em;
}
.keyboard-layout-viewer .viewer-key-image { display: block; width: min(72%, 30px); height: min(72%, 30px); object-fit: contain; }
.keyboard-layout-viewer .key-icon, .keyboard-layout-viewer .viewer-key-image { pointer-events: none; }
.keyboard-layout-viewer .key.pressed { background: linear-gradient(160deg, #3cc9c7, #5de4c7); color: #081018; }
.keyboard-layout-viewer .key[data-combo="true"] { outline: 3px dashed #fbbf24; outline-offset: -5px; }
.keyboard-layout-viewer .viewer-key[data-pressed="true"] {
  border: 3px solid #f8fafc; background: linear-gradient(#0f766e, #115e59);
  box-shadow: inset 0 -3px 0 #5eead4, 0 0 0 3px rgb(45 212 191 / 28%);
}
.keyboard-layout-viewer .viewer-key[data-combo="true"] { outline: 3px dashed #fbbf24; outline-offset: -5px; }
.keyboard-layout-viewer .key[class*="self-test-"], .keyboard-layout-viewer .viewer-key[class*="self-test-"] { outline: 4px solid transparent; outline-offset: 3px; }
.keyboard-layout-viewer .key[class*="self-test-"]::after, .keyboard-layout-viewer .viewer-key[class*="self-test-"]::after {
  position: absolute; right: 5px; bottom: 3px; display: grid; place-items: center;
  min-width: 16px; height: 16px; padding: 0 2px; border-radius: 999px;
  background: #101522; color: #fff; font: 800 11px/1 system-ui, sans-serif; text-shadow: none;
}
.keyboard-layout-viewer .key.self-test-expected, .keyboard-layout-viewer .viewer-key.self-test-expected { outline-color: #ffd467; }
.keyboard-layout-viewer .key.self-test-expected::after, .keyboard-layout-viewer .viewer-key.self-test-expected::after { content: "▶"; color: #ffd467; }
.keyboard-layout-viewer .key.self-test-passed, .keyboard-layout-viewer .viewer-key.self-test-passed { outline-color: #5ee09a; }
.keyboard-layout-viewer .key.self-test-passed::after, .keyboard-layout-viewer .viewer-key.self-test-passed::after { content: "✓"; color: #5ee09a; }
.keyboard-layout-viewer .key.self-test-unexpected, .keyboard-layout-viewer .viewer-key.self-test-unexpected { outline-color: #ff738e; }
.keyboard-layout-viewer .key.self-test-unexpected::after, .keyboard-layout-viewer .viewer-key.self-test-unexpected::after { content: "!"; color: #ff738e; }
.keyboard-layout-viewer .key.self-test-skipped, .keyboard-layout-viewer .viewer-key.self-test-skipped { outline: 4px dashed #aeb8ce; }
.keyboard-layout-viewer .key.self-test-skipped::after, .keyboard-layout-viewer .viewer-key.self-test-skipped::after { content: "S"; color: #d7deee; }
.keyboard-layout-viewer .key.self-test-not-testable, .keyboard-layout-viewer .viewer-key.self-test-not-testable { outline: 3px dotted #788399; }
.keyboard-layout-viewer .key.self-test-not-testable::after, .keyboard-layout-viewer .viewer-key.self-test-not-testable::after { content: "—"; color: #aeb8ce; }
`;

function emit(target, name, detail) {
  target.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
}

function labelText(key) {
  const label = key.label;
  if (label && typeof label === "object") return label.text ?? "";
  return label == null ? "" : String(label);
}

function renderLabel(document, element, key, mobile = false) {
  element.replaceChildren();
  element.removeAttribute?.("aria-label");
  if (!mobile) element.removeAttribute?.("role");
  if (key.code) element.dataset.key = String(key.code);
  else delete element.dataset.key;
  const labelObject = key.label && typeof key.label === "object" ? key.label : null;
  const accessibleLabel = key.accessibleLabel ?? key.alt ?? labelObject?.alt;
  const image = key.image ?? labelObject?.image;
  if (image) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = String(accessibleLabel ?? labelObject?.text ?? "");
    img.className = mobile ? "viewer-key-image" : "key-icon";
    if (typeof element.appendChild === "function") element.appendChild(img);
    else element.append?.(img);
  } else {
    const text = labelText(key);
    if (mobile) {
      const legend = document.createElement("span");
      legend.className = "viewer-key-legend";
      legend.textContent = text;
      if (typeof element.appendChild === "function") element.appendChild(legend);
      else element.append?.(legend);
    } else {
      element.textContent = text;
    }
  }
  if (accessibleLabel) {
    if (!mobile && labelObject?.alt) element.setAttribute("role", "img");
    element.setAttribute("aria-label", String(accessibleLabel));
  }
}

export function renderKeyboardLayoutInto(root, presentation, state = {}, { mobile = false, document = root.ownerDocument } = {}) {
  if (!presentation) { root.replaceChildren(); return []; }
  const { keys = [], keySize, width, height, origin } = presentation;
  if (!keySize || !Array.isArray(keys)) return [];
  const keyClass = mobile ? "viewer-key" : "key";
  const canvas = calcCanvasGeometry(keys, keySize, { margin: mobile ? 0 : 6 });
  const resolvedWidth = Number.isFinite(width) ? width : canvas.width;
  const resolvedHeight = Number.isFinite(height) ? height : canvas.height;
  const originX = Number.isFinite(origin?.x) ? origin.x : canvas.originX;
  const originY = Number.isFinite(origin?.y) ? origin.y : canvas.originY;
  root.classList?.add("keyboard-layout-viewer");
  root.style.width = `${resolvedWidth}px`;
  root.style.height = `${resolvedHeight}px`;
  root.style.setProperty("--key-w", `${keySize.w}px`);
  root.style.setProperty("--key-h", `${keySize.h}px`);
  root.style.setProperty("--gap", `${Number.isFinite(keySize.gap) ? keySize.gap : 0}px`);
  root.style.setProperty("--origin-x", `${originX}px`);
  root.style.setProperty("--origin-y", `${originY}px`);
  root.style.setProperty("--viewer-key-width", `${keySize.w}px`);
  root.style.setProperty("--viewer-key-height", `${keySize.h}px`);
  root.style.setProperty("--viewer-key-gap", `${Number.isFinite(keySize.gap) ? keySize.gap : 0}px`);
  root.style.setProperty("--viewer-origin-x", `${originX}px`);
  root.style.setProperty("--viewer-origin-y", `${originY}px`);
  const pressed = new Set(state.pressedPositions ?? []);
  const combos = new Set(state.comboPositions ?? []);
  const existingKeys = Array.from(root.children ?? []);
  const canReuse = existingKeys.length === keys.length && existingKeys.every((element, position) =>
    element.dataset?.index === String(position));
  const fragment = canReuse ? null : document.createDocumentFragment?.() ?? null;
  const renderedKeys = [];
  keys.forEach((key, position) => {
    const element = canReuse ? existingKeys[position] : document.createElement("div");
    const isPressed = pressed.has(position);
    const inCombo = combos.has(position);
    element.className = `${keyClass} ${key.kind ?? key.cls ?? ""}${isPressed ? " pressed" : ""}${inCombo ? " combo-key" : ""}`.trim();
    if (mobile) element.setAttribute("role", "img");
    element.dataset.index = String(position);
    element.dataset.position = String(position);
    element.dataset.pressed = String(isPressed);
    element.dataset.combo = String(inCombo);
    if (key.code) element.dataset.key = String(key.code);
    element.style.setProperty(mobile ? "--viewer-row" : "--row", key.row);
    element.style.setProperty(mobile ? "--viewer-col" : "--col", key.col);
    if (key.widthUnits ?? key.w) element.style.setProperty(mobile ? "--viewer-width" : "--w", key.widthUnits ?? key.w);
    if (key.heightUnits ?? key.h) element.style.setProperty(mobile ? "--viewer-height" : "--h", key.heightUnits ?? key.h);
    if (typeof key.angle === "number") element.style.setProperty(mobile ? "--viewer-angle" : "--angle", `${key.angle}deg`);
    renderLabel(document, element, key, mobile);
    const marker = state.keyMarkers?.[position];
    if (marker) {
      element.dataset.selfTestState = String(marker);
      element.className += ` self-test-${marker}`;
    }
    if (mobile) {
      const accessible = key.accessibleLabel || key.alt || labelText(key) || `Key ${position + 1}`;
      element.setAttribute("aria-label", `${accessible}${isPressed ? ", pressed" : inCombo ? ", active combo" : ""}`);
      element.setAttribute("aria-pressed", String(isPressed || inCombo));
      if (isPressed || inCombo) {
        const badge = document.createElement("span");
        badge.className = "viewer-key-state";
        badge.textContent = isPressed ? "DOWN" : "COMBO";
        if (typeof element.appendChild === "function") element.appendChild(badge);
        else element.append?.(badge);
      }
    }
    renderedKeys.push(element);
    if (fragment) fragment.appendChild(element);
  });
  if (!canReuse) {
    if (fragment) root.replaceChildren(fragment);
    else root.replaceChildren(...renderedKeys);
  }
  return renderedKeys;
}

function defineElement() {
  if (!globalThis.HTMLElement || !globalThis.customElements || globalThis.customElements.get(VIEWER_TAG)) return;

  class KeyboardLayoutViewer extends globalThis.HTMLElement {
    constructor() {
      super();
      this.presentation = null;
      this.state = {
        layerIndex: 0,
        layerAuthoritative: false,
        pressedPositions: null,
        comboPositions: null,
        keyMarkers: null,
        interactive: false,
      };
      this.activePointers = new Map(); // pointer id -> physical key position
      this.layerControls = new WeakSet();
      this.classList.add("keyboard-layout-viewer");
      this.installStyles();
      this.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
      this.addEventListener("pointerup", (event) => this.handlePointerEnd(event, false));
      this.addEventListener("pointercancel", (event) => this.handlePointerEnd(event, true));
      this.addEventListener("lostpointercapture", (event) => this.handlePointerEnd(event, true));
    }

    installStyles() {
      if (this.ownerDocument.querySelector("style[data-keyboard-viewer-styles]")) return;
      const style = this.ownerDocument.createElement("style");
      style.dataset.keyboardViewerStyles = "true";
      style.textContent = VIEWER_STYLES;
      this.ownerDocument.head?.appendChild(style);
    }

    setPresentation(presentation, state = this.state) {
      this.presentation = presentation ?? null;
      this.setState(state);
      this.render();
    }

    setState(state = {}) {
      this.state = {
        ...this.state,
        ...state,
        pressedPositions: Array.isArray(state.pressedPositions) ? [...state.pressedPositions] : this.state.pressedPositions,
        comboPositions: Array.isArray(state.comboPositions) ? [...state.comboPositions] : this.state.comboPositions,
        keyMarkers: state.keyMarkers && typeof state.keyMarkers === "object" ? { ...state.keyMarkers } : this.state.keyMarkers,
      };
      this.applyState();
    }

    setLayer(layerIndex, { authoritative = false } = {}) {
      this.setState({ layerIndex, layerAuthoritative: authoritative });
      this.dataset.layerIndex = String(layerIndex);
      this.dataset.layerAuthoritative = String(authoritative);
    }

    setKeyLabel(position, entry) {
      const element = this.querySelector(`[data-index="${position}"]`);
      if (!element) return false;
      renderLabel(this.ownerDocument, element, entry, this.dataset.viewer === "mobile");
      return true;
    }

    requestLayer(layerIndex) {
      if (!Number.isInteger(layerIndex) || this.state.layerAuthoritative) return false;
      emit(this, "keyboard-layer-request", { layerIndex });
      return true;
    }

    renderLayerControl(container, layers, layerIndex, { variant = "select", authoritative = false } = {}) {
      if (!container) return;
      const entries = (layers ?? []).map((layer, index) => ({
        index: Number.isInteger(layer?.index) ? layer.index : index,
        name: String(layer?.name ?? layer ?? `Layer ${index + 1}`),
      }));
      this.setLayer(layerIndex, { authoritative });
      if (variant === "select" && container.localName === "select") {
        const existing = Array.from(container.children ?? []);
        const canReuse = existing.length === entries.length;
        if (!canReuse) container.replaceChildren();
        entries.forEach((layer, index) => {
          const option = canReuse ? existing[index] : this.ownerDocument.createElement("option");
          option.value = String(layer.index);
          option.textContent = layer.name;
          if (!canReuse) container.appendChild(option);
        });
        container.value = String(layerIndex);
        container.disabled = authoritative || entries.length < 2;
        if (!this.layerControls.has(container)) {
          container.addEventListener("change", () => this.requestLayer(Number(container.value)));
          this.layerControls.add(container);
        }
        return;
      }
      container.replaceChildren();
      container.classList.toggle("keyboard-viewer-layer-readonly", authoritative);
      if (authoritative || variant !== "dots") {
        const name = entries.find((layer) => layer.index === layerIndex)?.name ?? `Layer ${layerIndex + 1}`;
        container.textContent = name;
        return;
      }
      const name = this.ownerDocument.createElement("span");
      name.className = "layer-name";
      name.textContent = entries.find((layer) => layer.index === layerIndex)?.name ?? `Layer ${layerIndex + 1}`;
      container.appendChild(name);
      const dots = this.ownerDocument.createElement("div");
      dots.className = "layer-dots";
      for (const layer of entries) {
        const button = this.ownerDocument.createElement("button");
        button.type = "button";
        button.className = `layer-dot${layer.index === layerIndex ? " active" : ""}`;
        button.dataset.index = String(layer.index);
        button.title = layer.name;
        button.setAttribute("aria-label", `Select ${layer.name}`);
        button.setAttribute("aria-pressed", String(layer.index === layerIndex));
        button.addEventListener("click", () => this.requestLayer(layer.index));
        dots.appendChild(button);
      }
      container.appendChild(dots);
    }

    setKeyMarkers(keyMarkers) {
      this.setState({ keyMarkers: keyMarkers && typeof keyMarkers === "object" ? keyMarkers : {} });
    }

    setPositionPressed(position, active) {
      if (!this.hasPosition(position)) return false;
      const pressed = new Set(this.state.pressedPositions ?? []);
      if (active) pressed.add(position);
      else pressed.delete(position);
      this.setState({ pressedPositions: [...pressed] });
      return true;
    }

    clearPressed() {
      this.setState({ pressedPositions: [] });
    }

    setComboPositions(positions) {
      this.setState({ comboPositions: Array.isArray(positions) ? positions : [] });
    }

    hasPosition(position) {
      return Number.isInteger(position) && Boolean(this.querySelector(`[data-index="${position}"]`));
    }

    keyLabelAt(position) {
      return this.querySelector(`[data-index="${position}"]`)?.textContent?.trim() ?? "";
    }

    resolveKeyPosition(code, wasShiftHeld = false, wasAltGrHeld = false) {
      if (typeof code !== "string" || !code) return null;
      const codes = wasAltGrHeld && wasShiftHeld
        ? [`AltGr+Shift+${code}`, `AltGr+${code}`, code]
        : wasAltGrHeld ? [`AltGr+${code}`, code]
          : wasShiftHeld ? [`Shift+${code}`, code] : [code];
      for (const candidate of codes) {
        const element = [...this.querySelectorAll(".key[data-key]")].find((key) => key.dataset.key === candidate);
        if (element) return Number(element.dataset.index);
      }
      if (["AltGr", "ShiftLeft", "ShiftRight"].includes(code)) {
        const element = [...this.querySelectorAll(".key[data-key]")].find((key) => key.dataset.key === code);
        if (element) return Number(element.dataset.index);
      }
      return null;
    }

    render() {
      if (!this.presentation) {
        this.replaceChildren();
        return;
      }
      const mobile = this.dataset.viewer === "mobile";
      renderKeyboardLayoutInto(this, this.presentation, this.state, { mobile });
      this.dataset.layerIndex = String(this.state.layerIndex ?? 0);
      this.dataset.layerAuthoritative = String(this.state.layerAuthoritative === true);
      this.applyState();
    }

    applyState() {
      const pressed = new Set(this.state.pressedPositions ?? []);
      const combos = new Set(this.state.comboPositions ?? []);
      for (const element of this.querySelectorAll(KEY_SELECTOR)) {
        const position = Number(element.dataset.position ?? element.dataset.index);
        const isPressed = pressed.has(position) || [...this.activePointers.values()].includes(position);
        const inCombo = combos.has(position);
        if (Array.isArray(this.state.pressedPositions) || this.state.interactive) {
          element.classList.toggle("pressed", isPressed);
          element.dataset.pressed = String(isPressed);
        }
        if (Array.isArray(this.state.comboPositions)) element.dataset.combo = String(inCombo);
        if (element.classList.contains("viewer-key")) {
          const label = element.getAttribute("aria-label") ?? element.textContent ?? "Key";
          element.setAttribute("aria-label", `${label.replace(/, (?:pressed|active combo)$/u, "")}${isPressed ? ", pressed" : inCombo ? ", active combo" : ""}`);
          element.setAttribute("aria-pressed", String(isPressed || inCombo));
          element.querySelector(".viewer-key-state")?.remove();
          if (isPressed || inCombo) {
            const state = this.ownerDocument.createElement("span");
            state.className = "viewer-key-state";
            state.textContent = isPressed ? "DOWN" : "COMBO";
            element.appendChild(state);
          }
        }
        if (inCombo) element.classList.add("combo-key");
        else element.classList.remove("combo-key");
        const marker = this.state.keyMarkers?.[position];
        if (marker && this.state.keyMarkers !== null) {
          element.dataset.selfTestState = String(marker);
          element.classList.add(`self-test-${marker}`);
        } else if (this.state.keyMarkers !== null) {
          delete element.dataset.selfTestState;
          for (const status of ["expected", "passed", "unexpected", "skipped", "not-testable"]) {
            element.classList.remove(`self-test-${status}`);
          }
        }
      }
    }

    handlePointerDown(event) {
      if (!this.state.interactive || event.button > 0) return;
      const target = /** @type {Element | null} */ (event.target);
      const element = target?.closest(KEY_SELECTOR);
      if (!element || !this.contains(element)) return;
      const position = Number(element.dataset.position ?? element.dataset.index);
      this.activePointers.set(event.pointerId, position);
      element.setPointerCapture?.(event.pointerId);
      this.applyState();
      event.stopPropagation();
      emit(this, "keyboard-position-down", { position, source: event.pointerType || "pointer" });
    }

    handlePointerEnd(event, cancelled) {
      const found = this.activePointers.get(event.pointerId) ?? null;
      if (found === null) return;
      this.activePointers.delete(event.pointerId);
      this.applyState();
      event.stopPropagation();
      emit(this, "keyboard-position-up", { position: found, source: event.pointerType || "pointer", cancelled });
    }
  }

  globalThis.customElements.define(VIEWER_TAG, KeyboardLayoutViewer);
}

defineElement();

export function isKeyboardLayoutViewer(element) {
  return Boolean(element && element.localName === VIEWER_TAG && typeof element.setPresentation === "function");
}
