function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function normalizeLayers(source) {
  if (Array.isArray(source)) return source;
  if (!isPlainObject(source)) return [];
  return Object.values(source).filter(Boolean);
}

export function validateLayoutDefinition(value) {
  if (!isPlainObject(value)) return { valid: false, error: "The layout must be a JSON object." };
  if (typeof value.name !== "string" || !value.name.trim()) {
    return { valid: false, error: "The layout needs a display name." };
  }
  const size = value.keySize;
  if (!isPlainObject(size) || ![size.w, size.h].every((number) => Number.isFinite(number) && number > 0)) {
    return { valid: false, error: "The layout needs positive key width and height values." };
  }
  if (!Array.isArray(value.keyPositions) || value.keyPositions.length === 0 || value.keyPositions.some(
    (key) => !isPlainObject(key) || !Number.isFinite(key.row) || !Number.isFinite(key.col),
  )) {
    return { valid: false, error: "The layout needs positioned keys with numeric rows and columns." };
  }
  const layers = normalizeLayers(value.keyLayers);
  if (!layers.length || !layers.some((layer) => Array.isArray(layer) && layer.length > 0)) {
    return { valid: false, error: "The layout needs at least one compatible key layer." };
  }
  return { valid: true, error: null, definition: value };
}
