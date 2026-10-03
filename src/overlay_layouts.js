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

/**
 * @typedef {import("./app_config.js").AppConfig} AppConfig
 * @typedef {import("./app_config.js").LayoutSource} LayoutSource
 * @typedef {import("./layout_semantics.js").LayoutDefinition} LayoutDefinition
 * @typedef {import("./layout_semantics.js").KeyPosition} KeyPosition
 * @typedef {import("./layout_semantics.js").KeyEntry} KeyEntry
 * @typedef {import("./layout_catalog.js").LayoutModel} LayoutModel
 * @typedef {import("./ble_layer_sync.js").BleLayerSource} BleLayerSource
 * @typedef {import("./input_source_sync_config.js").RuntimePlatform} RuntimePlatform
 * @typedef {{ key1?: KeyPosition, key2?: KeyPosition, code?: unknown, id?: unknown, positions?: unknown }} RawCombo
 * @typedef {{ key1: KeyPosition, key2: KeyPosition, code: string, id: number | null, positions: number[] | null }} ComboDefinition
 * @typedef {{ core?: { invoke?: (command: string, args?: unknown) => Promise<unknown> } }} TauriProviderValue
 * @typedef {{ runtimePlatform?: RuntimePlatform, tauriProvider?: () => TauriProviderValue | undefined }} OverlayLayoutRegistryOptions
 */

/**
 * @param {unknown} combo
 * @param {KeyPosition[]} [keyPositions]
 * @returns {ComboDefinition | null}
 */
function normalizeCombo(combo, keyPositions = []) {
  if (!combo || typeof combo !== "object") return null;
  /** @type {RawCombo} */
  const rawCombo = combo;
  const positions = Array.isArray(rawCombo.positions) ? rawCombo.positions : null;
  const position0 = positions && Number.isInteger(positions[0]) ? Number(positions[0]) : null;
  const position1 = positions && Number.isInteger(positions[1]) ? Number(positions[1]) : null;
  const key1 = rawCombo.key1 ?? (position0 !== null ? keyPositions[position0] : null);
  const key2 = rawCombo.key2 ?? (position1 !== null ? keyPositions[position1] : null);
  const { code } = rawCombo;
  if (!key1 || !key2 || !code) return null;
  if (typeof key1.row !== "number" || typeof key1.col !== "number") return null;
  if (typeof key2.row !== "number" || typeof key2.col !== "number") return null;
  return {
    key1,
    key2,
    code: String(code),
    id: Number.isInteger(rawCombo.id) && Number(rawCombo.id) > 0 ? Number(rawCombo.id) : null,
    positions: positions ? positions.map(Number) : null,
  };
}

/**
 * @param {OverlayLayoutRegistryOptions} [options]
 */
export function createOverlayLayoutRegistry({ runtimePlatform, tauriProvider = () => /** @type {typeof globalThis & { __TAURI__?: TauriProviderValue }} */ (globalThis).__TAURI__ } = {}) {
  const layoutAssetOwner = new InlineAssetPresentationOwner();
  /** @type {Record<string, LayoutDefinition>} */
  let layoutDefinitions = {};
  /** @type {Record<string, KeyEntry[][]>} */
  let normalizedLayoutLayers = {};
  /** @type {Record<string, LayoutModel>} */
  let layouts = {};
  /** @type {Record<string, KeyEntry[][]>} */
  let layoutLayers = {};
  /** @type {Record<string, string[]>} */
  let layoutLayerNames = {};
  /** @type {Record<string, string[]>} */
  let layoutLayerKeys = {};
  /** @type {Record<string, LayoutSource>} */
  let layoutSources = {};
  /** @type {Record<string, BleLayerSource | null>} */
  let layoutBleSources = {};
  /** @type {Record<string, unknown>} */
  let layoutInputSourceSync = {};
  /** @type {Record<string, ComboDefinition[]>} */
  let comboDefinitionsByLayout = {};
  /** @type {string[]} */
  let layoutLoadErrors = [];

  /**
   * @param {string} key
   * @param {LayoutSource | unknown} source
   * @returns {Promise<{ def: LayoutDefinition | null, error: string | null }>}
   */
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
        const message = err instanceof Error ? err.message : String(err);
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
          .filter((combo) => combo !== null);
      }
    }

    layoutLayers = normalizedLayoutLayers;
  }

  /** @param {AppConfig | null | undefined} config */
  async function loadLayoutDefinitions(config) {
    /** @type {Array<[string, LayoutDefinition]>} */
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

  /**
   * @param {string} key
   * @param {LayoutDefinition} definition
   */
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
