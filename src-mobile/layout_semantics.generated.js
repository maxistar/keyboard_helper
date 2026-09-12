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

export const LAYOUT_LIMITS = Object.freeze({
  nameLength: 80,
  keys: 256,
  layers: 32,
  combos: 128,
  coordinateMagnitude: 1024,
  keyDimension: 256,
  legendLength: 256,
});

function validBoundedText(value) {
  return value == null || (typeof value === "string" && value.length <= LAYOUT_LIMITS.legendLength);
}

function validLayerEntry(entry) {
  if (entry == null || typeof entry === "number" || typeof entry === "boolean") return true;
  if (typeof entry === "string") return validBoundedText(entry);
  if (Array.isArray(entry)) {
    return entry.length <= 3 && entry.every((value) => validBoundedText(value));
  }
  if (!isPlainObject(entry)) return false;
  return validBoundedText(entry.label) && validBoundedText(entry.text)
    && validBoundedText(entry.code) && validBoundedText(entry.image) && validBoundedText(entry.alt);
}

export function validateLayoutDefinition(value) {
  if (!isPlainObject(value)) return { valid: false, error: "The layout must be a JSON object." };
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > LAYOUT_LIMITS.nameLength) {
    return { valid: false, error: "The layout needs a display name of at most 80 characters." };
  }
  const size = value.keySize;
  if (!isPlainObject(size) || ![size.w, size.h].every(
    (number) => Number.isFinite(number) && number > 0 && number <= LAYOUT_LIMITS.keyDimension,
  ) || (size.gap != null && (!Number.isFinite(size.gap) || size.gap < 0 || size.gap > LAYOUT_LIMITS.keyDimension))) {
    return { valid: false, error: "The layout needs bounded positive key width and height values and a non-negative gap." };
  }
  if (!Array.isArray(value.keyPositions) || value.keyPositions.length === 0
    || value.keyPositions.length > LAYOUT_LIMITS.keys || value.keyPositions.some(
    (key) => !isPlainObject(key) || !Number.isFinite(key.row) || !Number.isFinite(key.col)
      || Math.abs(key.row) > LAYOUT_LIMITS.coordinateMagnitude
      || Math.abs(key.col) > LAYOUT_LIMITS.coordinateMagnitude
      || (key.w != null && (!Number.isFinite(key.w) || key.w <= 0 || key.w > LAYOUT_LIMITS.keyDimension))
      || (key.h != null && (!Number.isFinite(key.h) || key.h <= 0 || key.h > LAYOUT_LIMITS.keyDimension))
      || (key.angle != null && (!Number.isFinite(key.angle) || Math.abs(key.angle) > 360)),
  )) {
    return { valid: false, error: "The layout needs 1–256 keys with bounded numeric geometry." };
  }
  const layers = normalizeLayers(value.keyLayers);
  if (!layers.length || layers.length > LAYOUT_LIMITS.layers || !layers.some(
    (layer) => Array.isArray(layer) && layer.length > 0,
  ) || layers.some((layer) => !Array.isArray(layer) || layer.length > LAYOUT_LIMITS.keys || layer.some(
    (entry) => !validLayerEntry(entry),
  ))) {
    return { valid: false, error: "The layout needs 1–32 compatible bounded key layers." };
  }
  const validComboPoint = (point) => isPlainObject(point) && Number.isFinite(point.row)
    && Number.isFinite(point.col) && Math.abs(point.row) <= LAYOUT_LIMITS.coordinateMagnitude
    && Math.abs(point.col) <= LAYOUT_LIMITS.coordinateMagnitude;
  const validCombo = (combo) => {
    if (!isPlainObject(combo) || !validBoundedText(combo.code)) return false;
    const modern = Number.isInteger(combo.id) && Array.isArray(combo.positions)
      && combo.positions.length >= 2 && combo.positions.every((position) => Number.isInteger(position)
        && position >= 0 && position < value.keyPositions.length);
    const coordinate = validBoundedText(combo.id) && validComboPoint(combo.key1) && validComboPoint(combo.key2);
    return modern || coordinate;
  };
  if (value.combos != null && (!Array.isArray(value.combos) || value.combos.length > LAYOUT_LIMITS.combos
    || value.combos.some((combo) => !validCombo(combo)))) {
    return { valid: false, error: "The layout combo metadata is invalid or exceeds the supported bounds." };
  }
  return { valid: true, error: null, definition: value };
}
