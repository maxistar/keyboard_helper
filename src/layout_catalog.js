import { BUILTIN_LAYOUT_FILES, normalizeConfig } from "./app_config.js";

export function formatLayerName(rawName, index) {
  if (!rawName) return `Layer ${index + 1}`;
  const spaced = String(rawName).replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function normalizeLayerData(layerSource) {
  if (!layerSource) return { layers: [], names: [], layerKeys: [] };
  if (Array.isArray(layerSource)) {
    const layerKeys = layerSource.map((_, index) => String(index));
    return {
      layers: layerSource,
      names: layerSource.map((_, index) => `Layer ${index + 1}`),
      layerKeys,
    };
  }

  const { default: defaultLayer, ...rest } = layerSource;
  const entries = [];
  if (defaultLayer) entries.push(["default", defaultLayer]);
  for (const [name, layer] of Object.entries(rest)) {
    if (layer) entries.push([name, layer]);
  }
  return {
    layers: entries.map(([, layer]) => layer),
    names: entries.map(([name], index) => formatLayerName(name, index)),
    layerKeys: entries.map(([name]) => name),
  };
}

export function normalizeKeyEntry(entry) {
  if (entry === null || entry === undefined) return { label: null, code: null, explicit: false };
  if (Array.isArray(entry)) {
    const [text, code, image] = entry;
    return {
      label: image ? { text, image } : text,
      code: code ?? null,
      explicit: true,
    };
  }
  if (typeof entry === "object") {
    return {
      label: entry.image
        ? { text: entry.text ?? entry.label, image: entry.image, alt: entry.alt }
        : (entry.label ?? entry.text ?? entry),
      code: entry.code ?? null,
      explicit: true,
    };
  }
  return { label: entry, code: null, explicit: true };
}

export function effectiveLayerEntry(layers, layerIndex, positionIndex) {
  const baseEntry = layers?.[0]?.[positionIndex];
  const selectedEntry = layers?.[layerIndex]?.[positionIndex];
  return selectedEntry === null || selectedEntry === undefined ? baseEntry : selectedEntry;
}

export function buildKeysFromBase(keyPositions, layers) {
  return keyPositions.map((position, index) => {
    const entry = normalizeKeyEntry(layers?.[0]?.[index]);
    return { ...position, label: entry.label, code: entry.code };
  });
}

export function buildLayout(definition, layers) {
  return {
    name: definition.name,
    keySize: definition.keySize,
    keys: buildKeysFromBase(definition.keyPositions, layers),
  };
}

export async function loadLayoutDefinition(key, source, {
  fetchJson = async (fileName) => {
    const response = await fetch(fileName);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
  readExternal = null,
  builtinFiles = BUILTIN_LAYOUT_FILES,
} = {}) {
  if (source === true) {
    const fileName = builtinFiles[key];
    if (!fileName) return { definition: null, error: `No builtin layout file mapped for key ${key}` };
    try {
      return { definition: await fetchJson(fileName), error: null };
    } catch (error) {
      return { definition: null, error: `Failed to load ${fileName}: ${error?.message ?? error}` };
    }
  }
  if (typeof source === "string") {
    if (!readExternal) return { definition: null, error: "Tauri API unavailable; cannot load external layout" };
    try {
      const raw = await readExternal(source);
      return { definition: typeof raw === "string" ? JSON.parse(raw) : raw, error: null };
    } catch (error) {
      return { definition: null, error: `Failed to load external layout for ${key} from ${source}: ${error?.message ?? error}` };
    }
  }
  return { definition: null, error: null };
}

export async function loadLayoutCatalog(rawConfig, options = {}) {
  const config = normalizeConfig(rawConfig);
  const configured = Object.entries(config.layouts ?? {});
  const sources = configured.length ? Object.fromEntries(configured) : { ...BUILTIN_LAYOUT_FILES };
  const definitions = {};
  const errors = [];

  for (const [key, source] of Object.entries(sources)) {
    const normalizedSource = configured.length ? source : true;
    const result = await loadLayoutDefinition(key, normalizedSource, options);
    if (result.definition) definitions[key] = result.definition;
    else if (result.error) errors.push(result.error);
  }

  if (!Object.keys(definitions).length) {
    for (const key of Object.keys(BUILTIN_LAYOUT_FILES)) {
      const result = await loadLayoutDefinition(key, true, options);
      sources[key] = true;
      if (result.definition) definitions[key] = result.definition;
      else if (result.error) errors.push(result.error);
    }
  }

  return { config, definitions, sources, errors };
}
