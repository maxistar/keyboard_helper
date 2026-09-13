import {
  MOBILE_BUNDLED_LAYOUT_DEFINITIONS,
  MOBILE_BUNDLED_LAYOUT_ORDER,
} from "./bundled_layout_definitions.js";
import { createRandomUuid, hasOwn } from "./webview_compat.js";
import {
  canonicalJson,
  canonicalLayoutDigestInput,
  INLINE_ASSET_REFERENCE_PREFIX,
  parseLayoutJson,
  validateLayoutDefinition,
} from "./layout_semantics.generated.js";
import { verifyInlineAssetDecoding } from "./inline_asset_presentation.generated.js";
import {
  createMobileLayoutCatalog,
  layoutKeyFromReference,
  layoutReferenceFromKey,
} from "./layout_viewer_model.js";

export const CUSTOM_LAYOUT_RECORD_VERSION = 2;
export const LEGACY_CUSTOM_LAYOUT_RECORD_VERSION = 1;
export const SELECTED_LAYOUT_VERSION = 1;
export const CUSTOM_LAYOUT_MAX_BYTES = 1_048_576;
export const CUSTOM_LAYOUT_MAX_RECORDS = 128;
export const CUSTOM_LAYOUT_DIAGNOSTIC_LIMIT = 180;
const CUSTOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

function validInlineStoredAsset(asset) {
  return typeof asset?.id === "string"
    && asset.id.length > 0
    && asset.id.length <= 64
    && typeof asset.mimeType === "string"
    && Number.isInteger(asset.sizeBytes)
    && asset.sizeBytes > 0
    && asset.sizeBytes <= 131_072
    && Number.isInteger(asset.width)
    && asset.width > 0
    && asset.width <= 256
    && Number.isInteger(asset.height)
    && asset.height > 0
    && asset.height <= 256
    && DIGEST.test(asset.digest);
}

export class CustomLayoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CustomLayoutError";
    this.code = code;
  }
}

function diagnostic(value) {
  const text = String(value ?? "Custom layout unavailable.").replace(/\s+/gu, " ").trim();
  return text.length <= CUSTOM_LAYOUT_DIAGNOSTIC_LIMIT
    ? text
    : `${text.slice(0, CUSTOM_LAYOUT_DIAGNOSTIC_LIMIT - 1)}…`;
}

export function normalizeCustomLayoutName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function encodedSize(value) {
  return new TextEncoder().encode(value).byteLength;
}

function importedImageReference(value) {
  if (Array.isArray(value)) {
    if (value.length >= 3 && typeof value[2] === "string" && value[2].trim()) return value[2];
    for (const entry of value) {
      const nested = importedImageReference(entry);
      if (nested) return nested;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (typeof value.image === "string" && value.image.trim()) return value.image;
  for (const entry of Object.values(value)) {
    const nested = importedImageReference(entry);
    if (nested) return nested;
  }
  return null;
}

export function collectLayoutImageReferences(value, references = []) {
  if (Array.isArray(value)) {
    if (value.length >= 3 && typeof value[2] === "string" && value[2].trim()) references.push(value[2]);
    value.forEach((entry) => collectLayoutImageReferences(entry, references));
  } else if (value && typeof value === "object") {
    if (typeof value.image === "string" && value.image.trim()) references.push(value.image);
    Object.entries(value).forEach(([key, entry]) => {
      if (key !== "image") collectLayoutImageReferences(entry, references);
    });
  }
  return references;
}

export function validateImportedLayout(raw, options = {}) {
  if (typeof raw !== "string") {
    return { valid: false, code: "invalid-content", error: "The selected layout is not text." };
  }
  if (encodedSize(raw) > CUSTOM_LAYOUT_MAX_BYTES) {
    return { valid: false, code: "document-too-large", error: "The selected layout is larger than 1 MiB." };
  }
  let definition;
  try {
    definition = parseLayoutJson(raw, { maxBytes: CUSTOM_LAYOUT_MAX_BYTES });
  } catch {
    return { valid: false, code: "invalid-json", error: "The selected file is not valid JSON." };
  }
  const validation = validateLayoutDefinition(definition);
  if (!validation.valid) return { valid: false, code: "invalid-layout", error: validation.error };
  if (!validation.inlineAssets && !options.allowImages && importedImageReference(definition)) {
    return {
      valid: false,
      code: "image-assets-unsupported",
      error: "JSON layouts may only use image legends through embedded asset references.",
    };
  }
  return { valid: true, code: null, error: null, definition, inlineAssets: validation.inlineAssets ?? null };
}

export async function sha256BytesHex(bytes, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle?.digest) throw new CustomLayoutError("digest-unavailable", "Layout verification is unavailable.");
  const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value, cryptoApi = globalThis.crypto) {
  return sha256BytesHex(new TextEncoder().encode(value), cryptoApi);
}

export async function inlineAssetInventory(validation, cryptoApi = globalThis.crypto) {
  const inventory = [];
  for (const asset of validation.inlineAssets?.assets?.values?.() ?? []) {
    inventory.push({
      id: asset.id,
      mimeType: asset.mimeType,
      sizeBytes: asset.bytes.length,
      width: asset.width,
      height: asset.height,
      digest: await sha256BytesHex(asset.bytes, cryptoApi),
    });
  }
  return inventory.sort((left, right) => left.id.localeCompare(right.id, "en-US"));
}

export async function canonicalLayoutDigest(validation, cryptoApi = globalThis.crypto) {
  if (!validation?.valid) throw new CustomLayoutError("invalid-layout", "The layout must be valid before digesting.");
  const assetHashes = new Map();
  for (const asset of await inlineAssetInventory(validation, cryptoApi)) assetHashes.set(asset.id, asset.digest);
  return sha256Hex(canonicalJson(canonicalLayoutDigestInput(validation.definition, validation.inlineAssets, assetHashes)), cryptoApi);
}

function validRecordShape(record) {
  const legacy = record?.schemaVersion === LEGACY_CUSTOM_LAYOUT_RECORD_VERSION && !record.format && !record.assets;
  const standalone = record?.schemaVersion === CUSTOM_LAYOUT_RECORD_VERSION && record.format === "json"
    && (!record.assets || record.assets.length === 0)
    && (!record.inlineAssets || record.inlineAssets.every(validInlineStoredAsset));
  return (legacy || standalone)
    && CUSTOM_ID.test(record.id)
    && typeof record.name === "string" && record.name.trim().length > 0 && record.name.trim().length <= 80
    && record.normalizedName === normalizeCustomLayoutName(record.name)
    && DIGEST.test(record.digest)
    && typeof record.content === "string" && encodedSize(record.content) <= CUSTOM_LAYOUT_MAX_BYTES;
}

function sameInlineAssetInventory(stored = [], computed = []) {
  return canonicalJson(stored) === canonicalJson(computed);
}

function stripInlineTransport(value) {
  if (!value || typeof value !== "object") return value;
  const rest = { ...value };
  delete rest.embeddedAssets;
  delete rest.format;
  delete rest.version;
  return rest;
}

function mapDefinitionImages(value, resolved) {
  if (Array.isArray(value)) {
    const copy = value.map((entry) => mapDefinitionImages(entry, resolved));
    if (copy.length >= 3 && typeof copy[2] === "string") copy[2] = resolved.get(copy[2]) ?? copy[2];
    return copy;
  }
  if (!value || typeof value !== "object") return value;
  const copy = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapDefinitionImages(entry, resolved)]));
  if (typeof copy.image === "string") copy.image = resolved.get(copy.image) ?? copy.image;
  return copy;
}

function validSelectionShape(selection) {
  return selection?.schemaVersion === SELECTED_LAYOUT_VERSION
    && ["bundled", "custom"].includes(selection.source)
    && typeof selection.id === "string" && selection.id.length > 0 && selection.id.length <= 128
    && (selection.source !== "custom" || CUSTOM_ID.test(selection.id));
}

export class CustomLayoutController {
  constructor(viewerModel, adapter, options = {}) {
    if (!viewerModel?.replaceCatalog || !viewerModel?.selectLayout) throw new TypeError("A mobile layout viewer model is required.");
    this.viewerModel = viewerModel;
    this.adapter = adapter;
    this.crypto = options.crypto ?? globalThis.crypto;
    this.randomUUID = options.randomUUID ?? (() => createRandomUuid(this.crypto));
    this.sourceBundledDefinitions = options.bundledDefinitions ?? MOBILE_BUNDLED_LAYOUT_DEFINITIONS;
    this.bundledDefinitions = this.sourceBundledDefinitions;
    this.bundledOrder = options.bundledOrder ?? MOBILE_BUNDLED_LAYOUT_ORDER;
    this.defaultLayoutKey = options.defaultLayoutKey ?? "qwerty";
    this.urlApi = options.urlApi ?? globalThis.URL;
    this.Blob = options.Blob ?? globalThis.Blob;
    this.createImageBitmap = options.createImageBitmap ?? null;
    this.requireCompleteDecoding = options.requireCompleteDecoding ?? false;
    this.records = [];
    this.diagnostics = [];
    this.assetUrls = new Map();
  }

  get available() { return this.adapter?.available !== false; }

  recordForKey(key) {
    const reference = layoutReferenceFromKey(key);
    return reference?.source === "custom" ? this.records.find(({ id }) => id === reference.id) ?? null : null;
  }

  buildCatalog() {
    return createMobileLayoutCatalog({
      definitions: this.bundledDefinitions,
      order: this.bundledOrder,
      defaultLayoutKey: this.defaultLayoutKey,
      customRecords: this.records,
      diagnostics: this.diagnostics,
    });
  }

  revokeRecordAssets(id) {
    for (const url of this.assetUrls.get(id)?.values() ?? []) this.urlApi?.revokeObjectURL?.(url);
    this.assetUrls.delete(id);
  }

  createPresentationUrl(bytes, mimeType) {
    return this.urlApi.createObjectURL(new this.Blob([bytes], { type: mimeType }));
  }

  async resolveInlineRecord(record, validation) {
    if (!validation.inlineAssets) return Object.freeze({ ...record, definition: validation.definition });
    if (this.requireCompleteDecoding || this.createImageBitmap) {
      await verifyInlineAssetDecoding(validation, {
        createImageBitmapApi: this.createImageBitmap,
        BlobConstructor: this.Blob,
      });
    }
    const urls = new Map();
    try {
      for (const asset of validation.inlineAssets.assets.values()) {
        urls.set(`${INLINE_ASSET_REFERENCE_PREFIX}${asset.id}`, this.createPresentationUrl(asset.bytes, asset.mimeType));
      }
      this.assetUrls.set(record.id, urls);
      return Object.freeze({ ...record, definition: mapDefinitionImages(stripInlineTransport(validation.definition), urls) });
    } catch (error) {
      for (const url of urls.values()) this.urlApi?.revokeObjectURL?.(url);
      throw error;
    }
  }

  async resolveRecord(record, validation) {
    return this.resolveInlineRecord(record, validation);
  }

  async initialize() {
    if (!this.available) return { status: "unavailable", diagnostics: [] };
    this.dispose();
    const bundledDefinitions = {};
    for (const [key, definition] of Object.entries(this.sourceBundledDefinitions)) {
      const validation = validateLayoutDefinition(definition);
      if (!validation.valid) throw new CustomLayoutError("invalid-layout", validation.error);
      const resolved = validation.inlineAssets && (this.requireCompleteDecoding || this.createImageBitmap)
        ? await this.resolveInlineRecord({ id: `bundled:${key}` }, validation)
        : { definition: validation.definition };
      bundledDefinitions[key] = resolved.definition;
    }
    this.bundledDefinitions = Object.freeze(bundledDefinitions);
    const [loaded, saved] = await Promise.all([this.adapter.listRecords(), this.adapter.readSelection()]);
    const diagnostics = [...(loaded?.diagnostics ?? []), ...(saved?.diagnostic ? [saved.diagnostic] : [])];
    const records = [];
    for (const record of (loaded?.records ?? []).slice(0, CUSTOM_LAYOUT_MAX_RECORDS)) {
      if (record?.schemaVersion === CUSTOM_LAYOUT_RECORD_VERSION && record?.format === "package" && CUSTOM_ID.test(record?.id ?? "")) {
        await this.adapter.removeRecord(record.id).catch(() => {});
        diagnostics.push("A stored package layout was removed because the preview format is unsupported.");
        continue;
      }
      if (!validRecordShape(record)) {
        diagnostics.push("A stored custom layout was skipped because its record is invalid.");
        continue;
      }
      const validation = validateImportedLayout(record.content);
      const digest = validation.valid ? await canonicalLayoutDigest(validation, this.crypto) : record.digest;
      const inventory = validation.valid ? await inlineAssetInventory(validation, this.crypto) : [];
      if (!validation.valid || digest !== record.digest || !sameInlineAssetInventory(record.inlineAssets, inventory)) {
        diagnostics.push(`${record.name}: stored content failed validation and was skipped.`);
        continue;
      }
      records.push(await this.resolveRecord(record, validation));
    }
    this.records = records;
    this.diagnostics = diagnostics.map(diagnostic).slice(0, 8);
    const catalog = this.buildCatalog();
    const requested = validSelectionShape(saved?.selection) ? layoutKeyFromReference(saved.selection) : null;
    const selected = requested && hasOwn(catalog.definitions, requested)
      ? requested
      : catalog.selectedLayoutKey;
    this.viewerModel.replaceCatalog(catalog, selected);
    if (selected && selected !== requested) await this.adapter.writeSelection(layoutReferenceFromKey(selected));
    return { status: "ready", selectedLayoutKey: selected, diagnostics: [...this.diagnostics] };
  }

  async selectLayout(layoutKey) {
    if (!hasOwn(this.viewerModel.catalog.definitions, layoutKey)) {
      throw new CustomLayoutError("invalid-layout", "Choose an available layout.");
    }
    await this.adapter.writeSelection(layoutReferenceFromKey(layoutKey));
    return this.viewerModel.selectLayout(layoutKey);
  }

  async importLayout(confirmReplace = async () => false) {
    const picked = await this.adapter.pickLayout();
    if (picked?.cancelled) return { status: "cancelled" };
    if (picked?.kind === "package") {
      throw new CustomLayoutError("document-format-unsupported", "The .khlayout preview package format is no longer supported.");
    }
    const validation = validateImportedLayout(picked?.content);
    if (!validation.valid) throw new CustomLayoutError(validation.code, validation.error);
    const digest = await canonicalLayoutDigest(validation, this.crypto);
    if (!DIGEST.test(digest ?? "")) throw new CustomLayoutError("invalid-layout-digest", "The layout could not be verified.");
    const duplicate = this.records.find((record) => record.digest === digest);
    if (duplicate) {
      await this.selectLayout(`custom:${duplicate.id}`);
      return { status: "duplicate", record: duplicate };
    }
    const normalizedName = normalizeCustomLayoutName(validation.definition.name);
    const existing = this.records.find((record) => record.normalizedName === normalizedName);
    if (existing && !await confirmReplace(existing, validation.definition)) {
      return { status: "cancelled-replacement", record: existing };
    }
    const stored = {
      schemaVersion: CUSTOM_LAYOUT_RECORD_VERSION,
      id: existing?.id ?? this.randomUUID(),
      name: validation.definition.name.trim(),
      normalizedName,
      digest,
      content: picked.content,
      format: "json",
      inlineAssets: await inlineAssetInventory(validation, this.crypto),
    };
    const previousSelection = layoutReferenceFromKey(this.viewerModel.snapshot().selectedLayoutKey);
    const nextSelection = layoutReferenceFromKey(`custom:${stored.id}`);
    await this.adapter.writeSelection(nextSelection);
    try {
      await this.adapter.writeRecord(stored);
    } catch (error) {
      if (previousSelection) await this.adapter.writeSelection(previousSelection).catch(() => {});
      throw error;
    }
    if (existing) this.revokeRecordAssets(existing.id);
    const record = await this.resolveRecord(stored, validation);
    this.records = existing
      ? this.records.map((item) => item.id === existing.id ? record : item)
      : [...this.records, record];
    this.viewerModel.replaceCatalog(this.buildCatalog(), `custom:${record.id}`);
    return { status: existing ? "replaced" : "imported", record };
  }

  async removeLayout(layoutKey) {
    const record = this.recordForKey(layoutKey);
    if (!record) throw new CustomLayoutError("bundled-protected", "Bundled layouts cannot be removed.");
    const selected = this.viewerModel.snapshot().selectedLayoutKey === layoutKey;
    const fallback = this.buildCatalog().selectedLayoutKey;
    const previousSelection = layoutReferenceFromKey(layoutKey);
    if (selected && fallback) await this.adapter.writeSelection(layoutReferenceFromKey(fallback));
    try {
      await this.adapter.removeRecord(record.id);
    } catch (error) {
      if (selected) await this.adapter.writeSelection(previousSelection);
      throw error;
    }
    this.revokeRecordAssets(record.id);
    this.records = this.records.filter(({ id }) => id !== record.id);
    const catalog = this.buildCatalog();
    const next = selected ? catalog.selectedLayoutKey : this.viewerModel.snapshot().selectedLayoutKey;
    this.viewerModel.replaceCatalog(catalog, next);
    return { status: "removed", selectedLayoutKey: next };
  }

  dispose() {
    for (const id of [...this.assetUrls.keys()]) this.revokeRecordAssets(id);
  }
}
