import { qwertyLayout, qwertyLayers } from "./layout_qwertz.js";
import { corneLayout, corneLayers } from "./layout_corne.js";
import { dactylLayout, dactylLayers } from "./layout_dactyl.js";
import { magicLayout, magicLayers } from "./layout_magic.js";

const layouts = {
  qwerty: qwertyLayout,
  corne: corneLayout,
  dactyl: dactylLayout,
  magic: magicLayout,
};

const layoutLayers = {
  qwerty: qwertyLayers,
  corne: corneLayers,
  dactyl: dactylLayers,
  magic: magicLayers,
};

const layoutRoot = document.getElementById("layoutRoot");
let currentLayerIndex = 0;
let layerIndicatorEl = null;
let currentLayoutKey = "corne";
//let currentLayoutKey = "dactyl";
//let currentLayoutKey = "qwerty";
//let currentLayoutKey = "magic";

function applyKeySizes({ w, h, gap }) {
  const root = document.documentElement;
  root.style.setProperty("--key-w", `${w}px`);
  root.style.setProperty("--key-h", `${h}px`);
  root.style.setProperty("--gap", `${gap}px`);
}

function calcBounds(keys) {
  let maxCol = 0;
  let maxRow = 0;
  keys.forEach((k) => {
    const keyWidth = k.w ?? 1;
    const keyHeight = k.h ?? 1;
    if (k.col + keyWidth > maxCol) maxCol = k.col + keyWidth;
    if (k.row + keyHeight > maxRow) maxRow = k.row + keyHeight;
  });
  return { maxCol, maxRow };
}

function renderKeyLabel(el, label) {
  el.innerHTML = "";
  if (!label) return;

  if (typeof label === "object" && label.image) {
    const img = document.createElement("img");
    img.src = label.image;
    img.alt = label.alt ?? label.text ?? "";
    img.className = "key-icon";
    el.appendChild(img);
    return;
  }

  if (typeof label === "object" && "text" in label) {
    el.textContent = label.text ?? "";
    return;
  }

  el.textContent = label;
}

function normalizeLabel(entry) {
  if (!entry) return null;
  if (Array.isArray(entry)) {
    const [text, , image] = entry;
    if (image) {
      return { text, image };
    }
    return text;
  }
  return entry;
}

function renderKeyboard(layout) {
  layoutRoot.innerHTML = "";

  applyKeySizes(layout.keySize);

  const { w, h, gap } = layout.keySize;
  const { maxCol, maxRow } = calcBounds(layout.keys);
  const widthPx = maxCol * (w + gap) + w;
  const heightPx = maxRow * (h + gap) + h;
  layoutRoot.style.width = `${widthPx}px`;
  layoutRoot.style.height = `${heightPx}px`;

  layout.keys.forEach((k, key) => {
    const el = document.createElement("div");
    el.className = `key ${k.cls || ""}`.trim();
    renderKeyLabel(el, k.label);
    el.dataset.key = k.code;
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
}

function ensureLayerIndicator() {
  if (!layerIndicatorEl) {
    layerIndicatorEl = document.createElement("div");
    layerIndicatorEl.id = "layerIndicator";
    layerIndicatorEl.className = "layers-indicator";
  }

  if (!document.body.contains(layerIndicatorEl)) {
    document.body.appendChild(layerIndicatorEl);
  }
}

function renderLayerIndicator() {
  ensureLayerIndicator();
  const totalLayers = layoutLayers[currentLayoutKey]?.length ?? 1;
  layerIndicatorEl.innerHTML = "";

  for (let i = 0; i < totalLayers; i++) {
    const dot = document.createElement("span");
    dot.className = "layer-dot";
    if (i === currentLayerIndex) {
      dot.classList.add("active");
    }
    dot.dataset.index = i;
    dot.title = `Layer ${i + 1}`;
    dot.addEventListener("click", () => applyLayer(i));
    layerIndicatorEl.appendChild(dot);
  }
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
    renderKeyLabel(el, normalizeLabel(targetKey));
  });

  currentLayerIndex = safeIndex;
  renderLayerIndicator();
}

function shiftCorne() {
  applyLayer(1);
}

function normalCorne() {
  applyLayer(0);
}

function setDactylDefault() {
  applyLayer(0);
}

function setDactylLower() {
  console.log("Setting Dactyl lower layer");
  applyLayer(1);
}

function setDactylMagic() {
  console.log("Setting Dactyl lower layer");
  applyLayer(2);
}

function handleKey(code, type) {
  const el = document.querySelector(`.key[data-key="${code}"]`);
  console.log(`Key ${code} ${type}`);
  if (!el) return;
  if (type === "down") {
    if (currentLayoutKey === "corne" && code === "ShiftLeft") {
      // rerender labels and keycodes!!!
      shiftCorne();
    }

    if (currentLayoutKey === "dactyl" && code === "F18") {
      // rerender labels and keycodes!!!
      console.log("Setting Dactyl lower layer");
      setDactylLower();
      setTimeout(() => {
        setDactylDefault();
      }, 2000);
    }

    if (currentLayoutKey === "dactyl" && code === "F19") {
      // rerender labels and keycodes!!!
      console.log("Setting Dactyl magic layer");
      setDactylMagic();
      setTimeout(() => {
        setDactylDefault();
      }, 2000);
    }

    el.classList.add("pressed");
  } else if (type === "up") {
    el.classList.remove("pressed");

    if (currentLayoutKey === "corne" && code === "ShiftLeft") {
      // rerender labels and keycodes!!!
      normalCorne();
    }

    //if (currentLayoutKey === "dactyl" && code === 'F18') {
    // rerender labels and keycodes!!!
    //    setDactylDefault();
    //}

    //if (currentLayoutKey === "dactyl" && code === 'F19') {
    // rerender labels and keycodes!!!
    //    console.log("Un Setting Dactyl magic layer");
    //}
  }
}

function setLayout(key) {
  const layout = layouts[key];
  if (!layout) return;
  currentLayoutKey = key;
  currentLayerIndex = 0;
  renderKeyboard(layout);
}

window.addEventListener("DOMContentLoaded", () => {
  const tauri = window.__TAURI__;
  if (tauri) {
    tauri.core
      .invoke("start_keyboard_listener")
      .catch((err) => console.error("Failed to start listener:", err));

    tauri.event
      .listen("key_event", (e) => {
        const { key, event_type } = e.payload;
        handleKey(key, event_type);
      })
      .catch((err) => console.error("Failed to listen key_event:", err));

    tauri.event
      .listen("layout_selected", (e) => {
        const key = e.payload?.layout;
        if (typeof key === "string") {
          setLayout(key);
        }
      })
      .catch((err) => console.error("Failed to listen layout_selected:", err));

    if (typeof window.setupWindowModeToggle === "function") {
      window.setupWindowModeToggle(tauri);
    }
  } else {
    console.warn("Tauri global API (window.__TAURI__) is not available");
  }

  setLayout(currentLayoutKey);
});
