import { createMenu } from "./menu.js";

function buildKeysFromBase(keyPositions, layers) {
  const baseLayer = layers?.[0] ?? [];
  return keyPositions.map((k, index) => {
    const [label, code, image] = baseLayer[index] ?? [];
    return { ...k, label, code, image };
  });
}

function buildLayout(config, layers) {
  return {
    name: config.name,
    keySize: config.keySize,
    keys: buildKeysFromBase(config.keyPositions, layers),
  };
}

function formatLayerName(rawName, index) {
  if (!rawName) return `Layer ${index + 1}`;
  const spaced = String(rawName).replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function normalizeLayerData(layerSource) {
  if (!layerSource) return { layers: [], names: [] };

  if (Array.isArray(layerSource)) {
    return {
      layers: layerSource,
      names: layerSource.map((_, index) => `Layer ${index + 1}`),
    };
  }

  const { default: defaultLayer, ...rest } = layerSource;
  const entries = [];
  if (defaultLayer) entries.push(["default", defaultLayer]);
  for (const [key, value] of Object.entries(rest)) {
    if (value) entries.push([key, value]);
  }

  return {
    layers: entries.map(([, layer]) => layer),
    names: entries.map(([name], index) => formatLayerName(name, index)),
  };
}

const builtinLayoutFiles = {
  qwerty: "layout_qwerty.json",
  qwertz: "layout_qwertz.json",
  corne: "layout_corne.json",
  dactyl: "layout_dactyl.json",
  magic: "layout_magic.json",
  mac: "layout_mac.json",
};
let layoutDefinitions = {};
let normalizedLayoutLayers = {};
let layouts = {};
let layoutLayers = {};
let layoutLayerNames = {};

async function loadLayoutDefinition(key, source) {
  // source: true (builtin) or string path
  if (source === true) {
    const fileName = builtinLayoutFiles[key];
    if (!fileName) {
      console.warn(`No builtin layout file mapped for key ${key}`);
      return null;
    }
    try {
      const resp = await fetch(fileName);
      if (!resp.ok) {
        console.warn(`Failed to load ${fileName}: ${resp.status}`);
        return null;
      }
      return await resp.json();
    } catch (err) {
      console.warn(`Failed to parse ${fileName}`, err);
      return null;
    }
  }

  if (typeof source === "string") {
    const tauri = window.__TAURI__;
    if (!tauri?.core?.invoke) {
      console.warn("Tauri API unavailable; cannot load external layout:", key);
      return null;
    }
    try {
      const raw = await tauri.core.invoke("read_layout_file", { path: source });
      if (typeof raw !== "string") {
        console.warn(`External layout for ${key} did not return string content`);
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`Failed to load external layout for ${key} from ${source}`, err);
      return null;
    }
  }

  return null;
}

async function loadLayoutDefinitions(config) {
  const entries = [];
  const layoutConfig = config?.layouts;
  if (layoutConfig && typeof layoutConfig === "object") {
    for (const [key, source] of Object.entries(layoutConfig)) {
      const def = await loadLayoutDefinition(key, source);
      if (def) entries.push([key, def]);
    }
  } else {
    // fallback: load all built-in layouts
    for (const [key, fileName] of Object.entries(builtinLayoutFiles)) {
      if (!fileName) continue;
      const def = await loadLayoutDefinition(key, true);
      if (def) entries.push([key, def]);
    }
  }

  layoutDefinitions = Object.fromEntries(entries);
  rebuildLayoutData();
}

function rebuildLayoutData() {
  normalizedLayoutLayers = {};
  layoutLayerNames = {};
  layouts = {};

  for (const [key, def] of Object.entries(layoutDefinitions)) {
    const { layers, names } = normalizeLayerData(def.keyLayers);
    normalizedLayoutLayers[key] = layers;
    layoutLayerNames[key] = names;
    layouts[key] = buildLayout(def, layers);
  }

  layoutLayers = normalizedLayoutLayers;
}

const layoutRoot = document.getElementById("layoutRoot");
let currentLayerIndex = 0;
let layerIndicatorEl = null;
let menuControls = null;
let currentLayoutKey = "qwerty";

function getAllowedLayoutKeys(config) {
  const availableKeys = Object.keys(layoutDefinitions);
  return availableKeys;
}

function pickDefaultLayout(config, allowedKeys) {
  const preferred = config?.defaultLayout;
  console.log("Preferred layout from config:", preferred);
  if (preferred && allowedKeys.includes(preferred)) {
    return preferred;
  }
  if (allowedKeys.includes(currentLayoutKey)) {
    return currentLayoutKey;
  }
  return allowedKeys[0] ?? currentLayoutKey;
}

async function loadConfig() {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return null;
  try {
    const raw = await tauri.core.invoke("read_config_file");
    if (typeof raw !== "string") return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Failed to load config file, using defaults", err);
    return null;
  }
}

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

function normalizeKeyEntry(entry) { 
  if (!entry) return { label: null, code: null };

  if (Array.isArray(entry)) {
    const [text, code, image] = entry;
    if (image) {
      return { label: { text, image }, code };
    }
    return { label: text, code };
  }

  if (typeof entry === "object") {
    const label = entry.label ?? entry.text ?? entry;
    const code = entry.code ?? null;
    if (entry.image) {
      return { label: { text: entry.text ?? entry.label, image: entry.image, alt: entry.alt }, code };
    }
    return { label, code };
  }

  return { label: entry, code: null };
}

function renderKeyLabel(el, entry) {
  const { label, code } = normalizeKeyEntry(entry);
  el.innerHTML = "";
  if (code) {
    el.dataset.key = code;
  }
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
    //if (currentLayoutKey === "corne" && code === "ShiftLeft") {
      // rerender labels and keycodes!!!
    //  shiftCorne();
    //} 

    //if (currentLayoutKey === "corney" && (code === "ShiftLeft" || code === "ShiftRight")) {
      // rerender labels and keycodes!!!
//      shiftCorne();  
    //}        
 
    //if (currentLayoutKey === "dactyl" && code === "F18") {
      // rerender labels and keycodes!!!
    //  console.log("Setting Dactyl lower layer");
    //  setDactylLower(); 
    //  setTimeout(() => {
    //    setDactylDefault();
    //  }, 2000);
    //}

    //if (currentLayoutKey === "dactyl" && code === "F19") {
      // rerender labels and keycodes!!!
    //  console.log("Setting Dactyl magic layer");
    //  setDactylMagic();
    //  setTimeout(() => {
    //    setDactylDefault();
    //  }, 2000);
    //} 

    el.classList.add("pressed");  
  } else if (type === "up") {
    el.classList.remove("pressed");     

    //if (currentLayoutKey === "corne" && code === "ShiftLeft") {
      // rerender labels and keycodes!!!
    //  normalCorne();
    //}

    //if (currentLayoutKey === "corney" && (code === "ShiftLeft" || code === "ShiftRight")) {
      // rerender labels and keycodes!!!
    //  normalCorne();
    //}

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
  if (menuControls && typeof menuControls.updateActive === "function") {
    menuControls.updateActive();
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const tauri = window.__TAURI__;
  const config = await loadConfig();
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

  menuControls = createMenu({
    onLayoutSelect: setLayout,
    getCurrentLayoutKey: () => currentLayoutKey,
    layoutOptions: layoutMenuOptions,
  });
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
  if (menuControls && typeof menuControls.updateActive === "function") {
    menuControls.updateActive();
  }
});
