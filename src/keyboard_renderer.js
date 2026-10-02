import { normalizeKeyEntry } from "./layout_catalog.js";
import { calcCanvasGeometry } from "./layout_geometry.js";

// What the overlay draws outside a key cell: a combo border sits COMBO_BORDER_PADDING px beyond
// its keys and an active combo (or pressed key) adds an ACTIVE_RING px box-shadow. The layout
// element clips at its box, so the canvas margin is exactly their sum.
export const COMBO_BORDER_PADDING = 4;
export const ACTIVE_RING = 2;
export const OVERLAY_EDGE_MARGIN = COMBO_BORDER_PADDING + ACTIVE_RING;

export function calcOverlayCanvas(keys, keySize) {
  return calcCanvasGeometry(keys, keySize, { margin: OVERLAY_EDGE_MARGIN });
}

/** Sizes the layout element to the canvas and publishes the origin keys are positioned from. */
export function applyCanvasGeometry(root, canvas) {
  root.style.width = `${canvas.width}px`;
  root.style.height = `${canvas.height}px`;
  root.style.setProperty("--origin-x", `${canvas.originX}px`);
  root.style.setProperty("--origin-y", `${canvas.originY}px`);
}

export function calcKeyBounds(key, keySize) {
  return {
    width: keySize.w * (key.w ?? 1) + keySize.gap * ((key.w ?? 1) - 1),
    height: keySize.h * (key.h ?? 1) + keySize.gap * ((key.h ?? 1) - 1),
    left: key.col * (keySize.w + keySize.gap),
    top: key.row * (keySize.h + keySize.gap),
  };
}

export function renderKeyLabel(element, entry) {
  const { label, code } = normalizeKeyEntry(entry);
  element.innerHTML = "";
  element.removeAttribute("role");
  element.removeAttribute("aria-label");
  if (code) element.dataset.key = code;
  else delete element.dataset.key;
  if (!label) return;
  if (typeof label === "object" && label.image) {
    const image = element.ownerDocument.createElement("img");
    image.src = label.image;
    image.alt = label.alt ?? label.text ?? "";
    image.className = "key-icon";
    element.appendChild(image);
  } else {
    element.textContent = typeof label === "object" ? (label.text ?? "") : label;
    if (typeof label === "object" && label.alt) {
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", label.alt);
    }
  }
}

export function renderKeyboardGeometry(root, layout, { keyClass = "key", document = root.ownerDocument } = {}) {
  root.innerHTML = "";
  applyCanvasGeometry(root, calcOverlayCanvas(layout.keys, layout.keySize));
  return layout.keys.map((key, index) => {
    const element = document.createElement("div");
    element.className = `${keyClass} ${key.cls || ""}`.trim();
    renderKeyLabel(element, key);
    element.dataset.index = String(index);
    element.style.setProperty("--row", key.row);
    element.style.setProperty("--col", key.col);
    if (key.w) element.style.setProperty("--w", key.w);
    if (key.h) element.style.setProperty("--h", key.h);
    if (typeof key.angle === "number") element.style.setProperty("--angle", `${key.angle}deg`);
    root.appendChild(element);
    return element;
  });
}
