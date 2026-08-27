import { normalizeKeyEntry } from "./layout_catalog.js";

export function calcBounds(keys) {
  return keys.reduce((bounds, key) => ({
    maxCol: Math.max(bounds.maxCol, key.col + (key.w ?? 1)),
    maxRow: Math.max(bounds.maxRow, key.row + (key.h ?? 1)),
  }), { maxCol: 0, maxRow: 0 });
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
  }
}

export function renderKeyboardGeometry(root, layout, { keyClass = "key", document = root.ownerDocument } = {}) {
  root.innerHTML = "";
  const { w, h, gap = 0 } = layout.keySize;
  const bounds = calcBounds(layout.keys);
  root.style.width = `${bounds.maxCol * (w + gap) + w}px`;
  root.style.height = `${bounds.maxRow * (h + gap) + h}px`;
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
