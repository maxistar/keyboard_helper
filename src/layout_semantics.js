function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const INLINE_LAYOUT_FORMAT = "keyboard-helper-layout";
export const INLINE_LAYOUT_VERSION = 1;
export const INLINE_ASSET_REFERENCE_PREFIX = "asset:";

export const INLINE_LAYOUT_LIMITS = Object.freeze({
  documentBytes: 1_048_576,
  assets: 16,
  assetIdLength: 64,
  assetBytes: 131_072,
  aggregateAssetBytes: 524_288,
  bitmapDimension: 256,
});

export const INLINE_ASSET_MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

const INLINE_ASSET_ID = /^[A-Za-z0-9._-]{1,64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function jsonByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function parseLayoutJson(raw, { maxBytes = INLINE_LAYOUT_LIMITS.documentBytes } = {}) {
  if (typeof raw !== "string") throw new TypeError("The selected layout is not text.");
  if (jsonByteLength(raw) > maxBytes) throw new RangeError("The selected layout is larger than 1 MiB.");
  let offset = 0;
  const whitespace = () => { while (/\s/u.test(raw[offset] ?? "")) offset += 1; };
  const parseString = () => {
    const start = offset;
    offset += 1;
    let escaped = false;
    while (offset < raw.length) {
      const character = raw[offset];
      offset += 1;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") return JSON.parse(raw.slice(start, offset));
      else if (character.charCodeAt(0) < 0x20) break;
    }
    throw new SyntaxError("The selected file is not valid JSON.");
  };
  const parseValue = () => {
    whitespace();
    const character = raw[offset];
    if (character === "\"") return parseString();
    if (character === "[") {
      offset += 1;
      const result = [];
      whitespace();
      if (raw[offset] === "]") { offset += 1; return result; }
      while (offset < raw.length) {
        result.push(parseValue());
        whitespace();
        if (raw[offset] === "]") { offset += 1; return result; }
        if (raw[offset] !== ",") break;
        offset += 1;
      }
      throw new SyntaxError("The selected file is not valid JSON.");
    }
    if (character === "{") {
      offset += 1;
      const result = {};
      const keys = new Set();
      whitespace();
      if (raw[offset] === "}") { offset += 1; return result; }
      while (offset < raw.length) {
        whitespace();
        if (raw[offset] !== "\"") break;
        const key = parseString();
        if (keys.has(key)) throw new SyntaxError(`Duplicate JSON object key: ${key}`);
        keys.add(key);
        whitespace();
        if (raw[offset] !== ":") break;
        offset += 1;
        Object.defineProperty(result, key, {
          value: parseValue(),
          enumerable: true,
          configurable: true,
          writable: true,
        });
        whitespace();
        if (raw[offset] === "}") { offset += 1; return result; }
        if (raw[offset] !== ",") break;
        offset += 1;
      }
      throw new SyntaxError("The selected file is not valid JSON.");
    }
    const remainder = raw.slice(offset);
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(remainder)?.[0];
    if (!token) throw new SyntaxError("The selected file is not valid JSON.");
    offset += token.length;
    return JSON.parse(token);
  };
  const result = parseValue();
  whitespace();
  if (offset !== raw.length) throw new SyntaxError("The selected file is not valid JSON.");
  return result;
}

export function isInlineAssetReference(value) {
  return typeof value === "string" && value.startsWith(INLINE_ASSET_REFERENCE_PREFIX);
}

export function inlineAssetIdFromReference(value) {
  return isInlineAssetReference(value) ? value.slice(INLINE_ASSET_REFERENCE_PREFIX.length) : null;
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

function collectImageReferences(value, references = []) {
  if (Array.isArray(value)) {
    if (value.length >= 3 && typeof value[2] === "string" && value[2].trim()) references.push(value[2]);
    value.forEach((entry) => collectImageReferences(entry, references));
  } else if (isPlainObject(value)) {
    if (typeof value.image === "string" && value.image.trim()) references.push(value.image);
    Object.entries(value).forEach(([key, entry]) => {
      if (key !== "image") collectImageReferences(entry, references);
    });
  }
  return references;
}

export function collectLayoutImageReferences(value) {
  return collectImageReferences(value, []);
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeStrictBase64(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\t\n\f\r ]+/gu, "");
  if (!normalized || normalized.length % 4 !== 0 || !BASE64.test(normalized)) return null;
  try {
    if (!globalThis.atob) return null;
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function validateBitmapDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height)
    && width >= 1 && height >= 1
    && width <= INLINE_LAYOUT_LIMITS.bitmapDimension
    && height <= INLINE_LAYOUT_LIMITS.bitmapDimension;
}

function pngMetadata(bytes) {
  if (bytes.length < 33 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
  let offset = 8;
  let width = null;
  let height = null;
  let animated = false;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataOffset = offset + 8;
    const next = dataOffset + length + 4;
    if (next > bytes.length) return null;
    if (readUint32(bytes, dataOffset + length) !== crc32(bytes, offset + 4, dataOffset + length)) return null;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13 || width != null) return null;
      width = readUint32(bytes, dataOffset);
      height = readUint32(bytes, dataOffset + 4);
    } else if (type === "acTL") {
      animated = true;
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "IEND") {
      return length === 0 && next === bytes.length && width != null && height != null && sawImageData
        ? { mimeType: "image/png", width, height, animated }
        : null;
    }
    offset = next;
  }
  return null;
}

function jpegMetadata(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let width = null;
  let height = null;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return width != null && height != null && offset === bytes.length
      ? { mimeType: "image/jpeg", width, height, animated: false }
      : null;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return null;
      const scanHeaderLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (scanHeaderLength < 2 || offset + scanHeaderLength > bytes.length) return null;
      return width != null && height != null
        && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
        ? { mimeType: "image/jpeg", width, height, animated: false }
        : null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
    }
    offset += length;
  }
  return null;
}

function webpMetadata(bytes) {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const riffSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  if (riffSize + 8 !== bytes.length) return null;
  let offset = 12;
  let width = null;
  let height = null;
  let animated = false;
  while (offset + 8 <= bytes.length) {
    const chunk = ascii(bytes, offset, 4);
    const length = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    const data = offset + 8;
    if (length < 0 || data + length > bytes.length) return null;
    if (chunk === "VP8X") {
      if (length < 10) return null;
      animated ||= (bytes[data] & 0x02) !== 0;
      width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
    }
    if (chunk === "VP8 ") {
      if (length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
      width ??= (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff;
      height ??= (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff;
    }
    if (chunk === "VP8L") {
      if (length < 5 || bytes[data] !== 0x2f) return null;
      const bits = bytes[data + 1] | (bytes[data + 2] << 8) | (bytes[data + 3] << 16) | (bytes[data + 4] << 24);
      width ??= (bits & 0x3fff) + 1;
      height ??= ((bits >> 14) & 0x3fff) + 1;
    }
    if (chunk === "ANIM" || chunk === "ANMF") animated = true;
    offset = data + length + (length % 2);
  }
  return offset === bytes.length && width != null && height != null
    ? { mimeType: "image/webp", width, height, animated }
    : null;
}

function bitmapMetadata(bytes) {
  return pngMetadata(bytes) ?? jpegMetadata(bytes) ?? webpMetadata(bytes);
}

function validateInlineAssetTable(value) {
  if (value == null) return { valid: true, assetIds: new Set(), assets: new Map() };
  if (!isPlainObject(value)) return { valid: false, error: "Embedded layout assets must be a JSON object." };
  const entries = Object.entries(value);
  if (entries.length > INLINE_LAYOUT_LIMITS.assets) return { valid: false, error: "Embedded layout assets exceed the supported count." };
  const assetIds = new Set();
  const assets = new Map();
  let aggregateBytes = 0;
  for (const [id, asset] of entries) {
    if (!INLINE_ASSET_ID.test(id) || assetIds.has(id)) return { valid: false, error: "Embedded layout asset identifiers are invalid." };
    if (!isPlainObject(asset)
      || Object.keys(asset).sort().join(",") !== "data,encoding,mimeType"
      || typeof asset.mimeType !== "string"
      || asset.encoding !== "base64"
      || typeof asset.data !== "string") {
      return { valid: false, error: "Embedded layout assets must declare mimeType, base64 encoding, and data." };
    }
    const mimeType = asset.mimeType.toLocaleLowerCase("en-US");
    if (!INLINE_ASSET_MIME_TYPES.includes(mimeType) || asset.mimeType !== mimeType) {
      return { valid: false, error: "Embedded layout assets must be PNG, JPEG, or WebP images." };
    }
    const bytes = decodeStrictBase64(asset.data);
    if (!bytes || bytes.length === 0 || bytes.length > INLINE_LAYOUT_LIMITS.assetBytes) {
      return { valid: false, error: "Embedded layout asset data is invalid or too large." };
    }
    aggregateBytes += bytes.length;
    if (aggregateBytes > INLINE_LAYOUT_LIMITS.aggregateAssetBytes) {
      return { valid: false, error: "Embedded layout assets exceed the aggregate byte limit." };
    }
    const metadata = bitmapMetadata(bytes);
    if (!metadata || metadata.mimeType !== mimeType || metadata.animated || !validateBitmapDimensions(metadata.width, metadata.height)) {
      return { valid: false, error: "Embedded layout assets must be complete non-animated PNG, JPEG, or WebP images up to 256 pixels." };
    }
    assetIds.add(id);
    assets.set(id, Object.freeze({ id, mimeType, bytes, width: metadata.width, height: metadata.height }));
  }
  return { valid: true, assetIds, assets };
}

export function validateInlineLayoutContract(value) {
  const references = collectLayoutImageReferences(value);
  const assetReferences = references.filter(isInlineAssetReference);
  const hasInlineAssets = value?.embeddedAssets != null;
  const requiresInlineFormat = hasInlineAssets || assetReferences.length > 0;
  if (!requiresInlineFormat) return { valid: true, inline: false, assetIds: new Set(), assets: new Map(), references };
  if (value?.format !== INLINE_LAYOUT_FORMAT || value?.version !== INLINE_LAYOUT_VERSION) {
    return { valid: false, error: "Image-bearing JSON layouts must declare keyboard-helper-layout version 1." };
  }
  const assets = validateInlineAssetTable(value.embeddedAssets);
  if (!assets.valid) return assets;
  const referencedIds = new Set();
  for (const reference of assetReferences) {
    const id = inlineAssetIdFromReference(reference);
    if (!INLINE_ASSET_ID.test(id ?? "") || !assets.assetIds.has(id)) {
      return { valid: false, error: "Embedded layout asset references must resolve to declared assets." };
    }
    referencedIds.add(id);
  }
  if (references.length !== assetReferences.length) {
    return { valid: false, error: "Image-bearing JSON layouts may only reference embedded asset identifiers." };
  }
  for (const id of assets.assetIds) {
    if (!referencedIds.has(id)) return { valid: false, error: "Embedded layout assets must be referenced by the layout." };
  }
  return { valid: true, inline: true, assetIds: assets.assetIds, assets: assets.assets, references };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalKeyEntry(entry) {
  if (entry == null) return null;
  const normalized = normalizeKeyEntry(entry);
  const label = normalized.label && typeof normalized.label === "object"
    ? {
        text: normalized.label.text ?? null,
        image: normalized.label.image ?? null,
        alt: normalized.label.alt ?? null,
      }
    : normalized.label;
  return { label, code: normalized.code ?? null, explicit: normalized.explicit };
}

function canonicalSemanticLayout(definition) {
  const semanticLayout = { ...definition };
  delete semanticLayout.embeddedAssets;
  delete semanticLayout.format;
  delete semanticLayout.version;
  semanticLayout.name = definition.name.trim();
  semanticLayout.keySize = {
    w: definition.keySize.w,
    h: definition.keySize.h,
    gap: definition.keySize.gap ?? 0,
  };
  semanticLayout.keyPositions = definition.keyPositions.map((position) => ({
    row: position.row,
    col: position.col,
    w: position.w ?? 1,
    h: position.h ?? 1,
    angle: position.angle ?? 0,
    cls: position.cls ?? "",
  }));
  const layerData = normalizeLayerData(definition.keyLayers);
  semanticLayout.keyLayers = layerData.layers.map((layer, index) => ({
    id: layerData.layerKeys[index],
    entries: layer.map(canonicalKeyEntry),
  }));
  return semanticLayout;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalLayoutDigestInput(definition, inlineAssets = null, assetHashes = new Map()) {
  const semanticLayout = canonicalSemanticLayout(definition);
  const assets = [...(inlineAssets?.assets?.values?.() ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id, "en-US"))
    .map((asset) => ({
      id: asset.id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      sha256: assetHashes.get(asset.id),
    }));
  return canonicalValue({
    format: INLINE_LAYOUT_FORMAT,
    version: INLINE_LAYOUT_VERSION,
    layout: semanticLayout,
    assets,
  });
}

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
  const inlineContract = validateInlineLayoutContract(value);
  if (!inlineContract.valid) return { valid: false, error: inlineContract.error };
  return { valid: true, error: null, definition: value, inlineAssets: inlineContract.inline ? inlineContract : null };
}
