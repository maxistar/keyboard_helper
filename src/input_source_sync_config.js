function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function validLayerIndex(value, layerCount) {
  return Number.isInteger(value) && value >= 0 && value < layerCount;
}

export const DEFAULT_INPUT_SOURCE_SETTLE_MS = 1000;
export const MAX_INPUT_SOURCE_SETTLE_MS = 60_000;

export function detectRuntimePlatform(navigatorLike = globalThis.navigator) {
  const platform = String(navigatorLike?.userAgentData?.platform ?? navigatorLike?.platform ?? "").toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return "unknown";
}

function invalid(message) {
  return {
    config: null,
    error: `Invalid macOS input-source synchronization metadata: ${message}`,
  };
}

export function normalizeInputSourceSync(
  layoutDefinition,
  layerCount,
  { platform = detectRuntimePlatform() } = {},
) {
  const raw = layoutDefinition?.inputSourceSync?.macos;
  if (platform !== "macos" || raw === undefined || raw === null) {
    return { config: null, error: null };
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sources) || raw.sources.length === 0) {
    return invalid("macos.sources must be a non-empty array.");
  }
  const settleMs = raw.settleMs ?? DEFAULT_INPUT_SOURCE_SETTLE_MS;
  if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > MAX_INPUT_SOURCE_SETTLE_MS) {
    return invalid(`macos.settleMs must be an integer between 0 and ${MAX_INPUT_SOURCE_SETTLE_MS}.`);
  }

  const sourceIds = new Set();
  const inputSourceIds = new Set();
  const ownedLayers = new Set();
  const sources = [];

  for (const [index, rawSource] of raw.sources.entries()) {
    if (!rawSource || typeof rawSource !== "object") {
      return invalid(`sources[${index}] must be an object.`);
    }
    const id = nonEmptyString(rawSource.id);
    const label = nonEmptyString(rawSource.label);
    const inputSourceId = nonEmptyString(rawSource.inputSourceId);
    const baseLayer = rawSource.baseLayer;
    const layers = rawSource.layers;

    if (!id || !label || !inputSourceId) {
      return invalid(`sources[${index}] requires id, label, and inputSourceId.`);
    }
    if (sourceIds.has(id)) return invalid(`duplicate source id "${id}".`);
    if (inputSourceIds.has(inputSourceId)) {
      return invalid(`duplicate inputSourceId "${inputSourceId}".`);
    }
    if (!validLayerIndex(baseLayer, layerCount)) {
      return invalid(`sources[${index}].baseLayer is outside keyLayers.`);
    }
    if (!Array.isArray(layers) || layers.length === 0) {
      return invalid(`sources[${index}].layers must be a non-empty array.`);
    }

    const familyLayers = [];
    const familySet = new Set();
    for (const layer of layers) {
      if (!validLayerIndex(layer, layerCount)) {
        return invalid(`sources[${index}] contains a layer outside keyLayers.`);
      }
      if (familySet.has(layer)) {
        return invalid(`sources[${index}] contains duplicate layer ${layer}.`);
      }
      if (ownedLayers.has(layer)) {
        return invalid(`layer ${layer} belongs to more than one source family.`);
      }
      familySet.add(layer);
      ownedLayers.add(layer);
      familyLayers.push(layer);
    }
    if (!familySet.has(baseLayer)) {
      return invalid(`sources[${index}].layers must contain its baseLayer.`);
    }

    sourceIds.add(id);
    inputSourceIds.add(inputSourceId);
    sources.push({ id, label, inputSourceId, baseLayer, layers: familyLayers });
  }

  const neutralLayers = [];
  const neutralSet = new Set();
  const rawNeutralLayers = raw.neutralLayers ?? [];
  if (!Array.isArray(rawNeutralLayers)) {
    return invalid("macos.neutralLayers must be an array.");
  }
  for (const layer of rawNeutralLayers) {
    if (!validLayerIndex(layer, layerCount)) {
      return invalid("neutralLayers contains a layer outside keyLayers.");
    }
    if (neutralSet.has(layer)) return invalid(`neutral layer ${layer} is duplicated.`);
    if (ownedLayers.has(layer)) {
      return invalid(`neutral layer ${layer} also belongs to a source family.`);
    }
    neutralSet.add(layer);
    neutralLayers.push(layer);
  }

  return {
    config: { sources, neutralLayers, settleMs },
    error: null,
  };
}
