import {
  BUILTIN_LAYOUT_FILES,
  parseExternalLayout,
} from "./app_config.js";
import {
  buildLayout,
  normalizeLayerData,
} from "./layout_catalog.js";
import { InlineAssetPresentationOwner } from "./inline_asset_presentation.js";
import { parseLayoutJson } from "./layout_semantics.js";
import { normalizeInputSourceSync } from "./input_source_sync_config.js";
import { normalizeBleLayerSource } from "./ble_layer_sync.js";

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

export function createOverlayLayoutRegistry({ runtimePlatform, tauriProvider = () => window.__TAURI__ } = {}) {
  const layoutAssetOwner = new InlineAssetPresentationOwner();
  let layoutDefinitions = {};
  let normalizedLayoutLayers = {};
  let layouts = {};
  let layoutLayers = {};
  let layoutLayerNames = {};
  let layoutLayerKeys = {};
  let layoutSources = {};
  let layoutBleSources = {};
  let layoutInputSourceSync = {};
  let comboDefinitionsByLayout = {};
  let layoutLoadErrors = [];

  async function loadLayoutDefinition(key, source) {
    if (source === true) {
      const fileName = BUILTIN_LAYOUT_FILES[key];
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
        const definition = parseLayoutJson(await resp.text());
        const resolved = await layoutAssetOwner.resolve(key, definition);
        if (!resolved.validation.valid) throw new Error(resolved.validation.error);
        return { def: resolved.definition, error: null };
      } catch (err) {
        const error = `Failed to parse ${fileName}`;
        console.warn(error, err);
        return { def: null, error };
      }
    }

    if (typeof source === "string") {
      const tauri = tauriProvider();
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
        const parsed = parseExternalLayout(raw);
        if (!parsed.valid) throw new Error(parsed.error);
        const resolved = await layoutAssetOwner.resolve(key, parsed.definition);
        if (!resolved.validation.valid) throw new Error(resolved.validation.error);
        return { def: resolved.definition, error: null };
      } catch (err) {
        const message = err?.message ?? String(err);
        const error = `Failed to load external layout for ${key} from ${source}: ${message}`;
        console.warn(error, err);
        return { def: null, error };
      }
    }

    return { def: null, error: null };
  }

  function rebuildLayoutData() {
    normalizedLayoutLayers = {};
    layoutLayerNames = {};
    layoutLayerKeys = {};
    layouts = {};
    layoutBleSources = {};
    layoutInputSourceSync = {};
    comboDefinitionsByLayout = {};

    for (const [key, def] of Object.entries(layoutDefinitions)) {
      const { layers, names, layerKeys } = normalizeLayerData(def.keyLayers);
      normalizedLayoutLayers[key] = layers;
      layoutLayerNames[key] = names;
      layoutLayerKeys[key] = layerKeys;
      layouts[key] = buildLayout(def, layers);
      layoutBleSources[key] = normalizeBleLayerSource(def);
      const inputSourceSync = normalizeInputSourceSync(def, layers.length, { platform: runtimePlatform });
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
      for (const [key, fileName] of Object.entries(BUILTIN_LAYOUT_FILES)) {
        if (!fileName) continue;
        layoutSources[key] = true;
        const { def } = await loadLayoutDefinition(key, true);
        if (def) entries.push([key, def]);
      }
    }

    if (entries.length === 0) {
      for (const key of Object.keys(BUILTIN_LAYOUT_FILES)) {
        layoutSources[key] = true;
        const { def, error } = await loadLayoutDefinition(key, true);
        if (def) entries.push([key, def]);
        else if (error) layoutLoadErrors.push(error);
      }
    }

    layoutDefinitions = Object.fromEntries(entries);
    layoutAssetOwner.retain(entries.map(([key]) => key));
    rebuildLayoutData();
  }

  function getAllowedLayoutKeys() {
    return Object.keys(layoutDefinitions);
  }

  function applyLayoutDefinition(key, definition) {
    layoutDefinitions = { ...layoutDefinitions, [key]: definition };
    rebuildLayoutData();
  }

  function dispose() {
    layoutAssetOwner.dispose();
  }

  return {
    loadLayoutDefinition,
    loadLayoutDefinitions,
    applyLayoutDefinition,
    getAllowedLayoutKeys,
    dispose,
    get layoutDefinitions() { return layoutDefinitions; },
    get layoutLayers() { return layoutLayers; },
    get layoutLayerNames() { return layoutLayerNames; },
    get layoutLayerKeys() { return layoutLayerKeys; },
    get layouts() { return layouts; },
    get layoutSources() { return layoutSources; },
    get layoutBleSources() { return layoutBleSources; },
    get layoutInputSourceSync() { return layoutInputSourceSync; },
    get comboDefinitionsByLayout() { return comboDefinitionsByLayout; },
    get layoutLoadErrors() { return layoutLoadErrors; },
  };
}
