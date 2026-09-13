import { BUILTIN_LAYOUT_FILES, normalizeConfig } from "./app_config.js";
import { resolveInlineLayoutAssets, verifyInlineAssetDecoding } from "./inline_asset_presentation.js";
import {
  collectLayoutImageReferences,
  normalizeKeyEntry,
  parseLayoutJson,
  validateLayoutDefinition,
} from "./layout_semantics.js";

export {
  effectiveLayerEntry,
  formatLayerName,
  normalizeKeyEntry,
  normalizeLayerData,
} from "./layout_semantics.js";

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
  urlApi = globalThis.URL,
  BlobConstructor = globalThis.Blob,
  createImageBitmapApi = globalThis.createImageBitmap,
  requireCompleteDecoding = false,
} = {}) {
  if (source === true) {
    const fileName = builtinFiles[key];
    if (!fileName) return { definition: null, error: `No builtin layout file mapped for key ${key}` };
    try {
      const definition = await fetchJson(fileName);
      const validation = validateLayoutDefinition(definition);
      if (!validation.valid) throw new Error(validation.error);
      if (validation.inlineAssets && (requireCompleteDecoding || createImageBitmapApi)) {
        await verifyInlineAssetDecoding(validation, { createImageBitmapApi, BlobConstructor });
      }
      const resolved = resolveInlineLayoutAssets(definition, { urlApi, BlobConstructor });
      return { definition: resolved.definition, revoke: resolved.revoke, error: null };
    } catch (error) {
      return { definition: null, error: `Failed to load ${fileName}: ${error?.message ?? error}` };
    }
  }
  if (typeof source === "string") {
    if (!readExternal) return { definition: null, error: "Tauri API unavailable; cannot load external layout" };
    try {
      const raw = await readExternal(source);
      const definition = typeof raw === "string" ? parseLayoutJson(raw) : raw;
      const validation = validateLayoutDefinition(definition);
      if (!validation.valid) throw new Error(validation.error);
      if (validation.inlineAssets && (requireCompleteDecoding || createImageBitmapApi)) {
        await verifyInlineAssetDecoding(validation, { createImageBitmapApi, BlobConstructor });
      }
      const resolved = resolveInlineLayoutAssets(definition, { urlApi, BlobConstructor });
      if (!resolved.validation.inlineAssets && collectLayoutImageReferences(definition).length) {
        throw new Error("External JSON layouts may only use image legends through embedded asset references.");
      }
      return { definition: resolved.definition, revoke: resolved.revoke, error: null };
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
  const revocations = [];

  for (const [key, source] of Object.entries(sources)) {
    const normalizedSource = configured.length ? source : true;
    const result = await loadLayoutDefinition(key, normalizedSource, options);
    if (result.definition) {
      definitions[key] = result.definition;
      if (result.revoke) revocations.push(result.revoke);
    }
    else if (result.error) errors.push(result.error);
  }

  if (!Object.keys(definitions).length) {
    for (const key of Object.keys(BUILTIN_LAYOUT_FILES)) {
      const result = await loadLayoutDefinition(key, true, options);
      sources[key] = true;
      if (result.definition) {
        definitions[key] = result.definition;
        if (result.revoke) revocations.push(result.revoke);
      }
      else if (result.error) errors.push(result.error);
    }
  }

  return {
    config,
    definitions,
    sources,
    errors,
    dispose: () => revocations.splice(0).forEach((revoke) => revoke()),
  };
}
