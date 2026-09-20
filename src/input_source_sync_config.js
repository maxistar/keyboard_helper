/** @typedef {"macos" | "windows" | "linux" | "unknown"} RuntimePlatform */
/** @typedef {"macos" | "windows" | "x11" | "unknown"} InputSourceAdapterKind */
/** @typedef {{ id: string, label: string, inputSourceId: string, baseLayer: number, layers: number[] }} InputSourceDefinition */
/** @typedef {{ platform: RuntimePlatform, adapter: InputSourceAdapterKind, sources: InputSourceDefinition[], neutralLayers: number[], settleMs: number }} InputSourceSyncConfig */
/** @typedef {{ config: InputSourceSyncConfig, error: null } | { config: null, error: string | null }} InputSourceSyncNormalization */
/** @typedef {{ platform?: string, userAgentData?: { platform?: string } }} NavigatorPlatformLike */
/** @typedef {{ raw: unknown, path: string, adapter: InputSourceAdapterKind }} PlatformConfigSelection */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

/** @param {unknown} value @returns {string | null} */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** @param {unknown} value @param {number} layerCount @returns {value is number} */
function validLayerIndex(value, layerCount) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < layerCount;
}

export const DEFAULT_INPUT_SOURCE_SETTLE_MS = 1000;
export const MAX_INPUT_SOURCE_SETTLE_MS = 60_000;

/** @param {NavigatorPlatformLike} [navigatorLike] @returns {RuntimePlatform} */
export function detectRuntimePlatform(navigatorLike = globalThis.navigator) {
  const platform = String(navigatorLike?.userAgentData?.platform ?? navigatorLike?.platform ?? "").toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return "unknown";
}

/** @param {RuntimePlatform} platform @param {Record<string, unknown>} inputSourceSync @returns {PlatformConfigSelection} */
function platformConfig(platform, inputSourceSync) {
  if (platform === "macos" || platform === "windows") {
    return {
      raw: inputSourceSync[platform],
      path: platform,
      adapter: platform,
    };
  }
  if (platform === "linux") {
    const linux = isRecord(inputSourceSync.linux) ? inputSourceSync.linux : null;
    return {
      raw: linux?.x11,
      path: "linux.x11",
      adapter: "x11",
    };
  }
  return { raw: undefined, path: "", adapter: "unknown" };
}

const XKB_LAYOUT_SOURCE_ID = /^xkb:layout:[A-Za-z0-9_+.-]+(?::[A-Za-z0-9_+.-]+)?$/;
const XKB_GROUP_SOURCE_ID = /^xkb:group:[0-3]$/;

/** @param {string} inputSourceId */
export function isValidWindowsInputSourceId(inputSourceId) {
  return /^windows:klid:[0-9A-F]{8}$/.test(inputSourceId)
    && inputSourceId !== "windows:klid:00000000";
}

/** @param {string} inputSourceId */
export function isValidXkbInputSourceId(inputSourceId) {
  return XKB_LAYOUT_SOURCE_ID.test(inputSourceId) || XKB_GROUP_SOURCE_ID.test(inputSourceId);
}

/** @param {RuntimePlatform} platform @returns {string} */
function platformLabel(platform) {
  if (platform === "macos") return "macOS";
  if (platform === "windows") return "Windows";
  if (platform === "linux") return "Linux";
  return "current platform";
}

/** @param {RuntimePlatform} platform @param {string} message @returns {{ config: null, error: string }} */
function invalid(platform, message) {
  return {
    config: null,
    error: `Invalid ${platformLabel(platform)} input-source synchronization metadata: ${message}`,
  };
}

/**
 * @param {unknown} layoutDefinition
 * @param {number} layerCount
 * @param {{ platform?: RuntimePlatform }} [options]
 * @returns {InputSourceSyncNormalization}
 */
export function normalizeInputSourceSync(
  layoutDefinition,
  layerCount,
  { platform = detectRuntimePlatform() } = {},
) {
  const inputSourceSync = isRecord(layoutDefinition) && isRecord(layoutDefinition.inputSourceSync)
    ? layoutDefinition.inputSourceSync
    : null;
  if (!inputSourceSync) return { config: null, error: null };
  const selected = platformConfig(platform, inputSourceSync);
  if (!selected.path) return { config: null, error: null };
  const raw = selected.raw;
  if (raw === undefined || raw === null) {
    return { config: null, error: null };
  }
  if (!isRecord(raw) || !Array.isArray(raw.sources) || raw.sources.length === 0) {
    return invalid(platform, `${selected.path}.sources must be a non-empty array.`);
  }
  const settleMs = raw.settleMs ?? DEFAULT_INPUT_SOURCE_SETTLE_MS;
  if (typeof settleMs !== "number" || !Number.isInteger(settleMs) || settleMs < 0 || settleMs > MAX_INPUT_SOURCE_SETTLE_MS) {
    return invalid(platform, `${selected.path}.settleMs must be an integer between 0 and ${MAX_INPUT_SOURCE_SETTLE_MS}.`);
  }

  const sourceIds = new Set();
  const inputSourceIds = new Set();
  const ownedLayers = new Set();
  /** @type {InputSourceDefinition[]} */
  const sources = [];

  for (const [index, rawSource] of raw.sources.entries()) {
    if (!isRecord(rawSource)) {
      return invalid(platform, `sources[${index}] must be an object.`);
    }
    const id = nonEmptyString(rawSource.id);
    const label = nonEmptyString(rawSource.label);
    const inputSourceId = nonEmptyString(rawSource.inputSourceId);
    const baseLayer = rawSource.baseLayer;
    const layers = rawSource.layers;

    if (!id || !label || !inputSourceId) {
      return invalid(platform, `sources[${index}] requires id, label, and inputSourceId.`);
    }
    if (selected.adapter === "x11" && !isValidXkbInputSourceId(inputSourceId)) {
      return invalid(platform, `sources[${index}].inputSourceId must use xkb:layout:<layout>[:<variant>] or xkb:group:<0-3>.`);
    }
    if (selected.adapter === "windows" && !isValidWindowsInputSourceId(inputSourceId)) {
      return invalid(platform, `sources[${index}].inputSourceId must use windows:klid:<8 uppercase hex digits> with a nonzero KLID.`);
    }
    if (sourceIds.has(id)) return invalid(platform, `duplicate source id "${id}".`);
    if (inputSourceIds.has(inputSourceId)) {
      return invalid(platform, `duplicate inputSourceId "${inputSourceId}".`);
    }
    if (!validLayerIndex(baseLayer, layerCount)) {
      return invalid(platform, `sources[${index}].baseLayer is outside keyLayers.`);
    }
    if (!Array.isArray(layers) || layers.length === 0) {
      return invalid(platform, `sources[${index}].layers must be a non-empty array.`);
    }

    /** @type {number[]} */
    const familyLayers = [];
    const familySet = new Set();
    for (const layer of layers) {
      if (!validLayerIndex(layer, layerCount)) {
        return invalid(platform, `sources[${index}] contains a layer outside keyLayers.`);
      }
      if (familySet.has(layer)) {
        return invalid(platform, `sources[${index}] contains duplicate layer ${layer}.`);
      }
      if (ownedLayers.has(layer)) {
        return invalid(platform, `layer ${layer} belongs to more than one source family.`);
      }
      familySet.add(layer);
      ownedLayers.add(layer);
      familyLayers.push(layer);
    }
    if (!familySet.has(baseLayer)) {
      return invalid(platform, `sources[${index}].layers must contain its baseLayer.`);
    }

    sourceIds.add(id);
    inputSourceIds.add(inputSourceId);
    sources.push({ id, label, inputSourceId, baseLayer, layers: familyLayers });
  }

  /** @type {number[]} */
  const neutralLayers = [];
  const neutralSet = new Set();
  const rawNeutralLayers = raw.neutralLayers ?? [];
  if (!Array.isArray(rawNeutralLayers)) {
    return invalid(platform, `${selected.path}.neutralLayers must be an array.`);
  }
  for (const layer of rawNeutralLayers) {
    if (!validLayerIndex(layer, layerCount)) {
      return invalid(platform, "neutralLayers contains a layer outside keyLayers.");
    }
    if (neutralSet.has(layer)) return invalid(platform, `neutral layer ${layer} is duplicated.`);
    if (ownedLayers.has(layer)) {
      return invalid(platform, `neutral layer ${layer} also belongs to a source family.`);
    }
    neutralSet.add(layer);
    neutralLayers.push(layer);
  }

  return {
    config: { platform, adapter: selected.adapter, sources, neutralLayers, settleMs },
    error: null,
  };
}
