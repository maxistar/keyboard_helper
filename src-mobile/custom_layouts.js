import {
  MOBILE_BUNDLED_LAYOUT_DEFINITIONS,
  MOBILE_BUNDLED_LAYOUT_ORDER,
} from "./bundled_layout_definitions.js";
import { validateLayoutDefinition } from "./layout_semantics.generated.js";
import {
  createMobileLayoutCatalog,
  layoutKeyFromReference,
  layoutReferenceFromKey,
} from "./layout_viewer_model.js";

export const CUSTOM_LAYOUT_RECORD_VERSION = 2;
export const LEGACY_CUSTOM_LAYOUT_RECORD_VERSION = 1;
export const SELECTED_LAYOUT_VERSION = 1;
export const CUSTOM_LAYOUT_MAX_BYTES = 524_288;
export const CUSTOM_LAYOUT_MAX_RECORDS = 128;
export const CUSTOM_LAYOUT_DIAGNOSTIC_LIMIT = 180;
export const LAYOUT_PACKAGE_FORMAT = "keyboard-helper-layout-package";
export const LAYOUT_PACKAGE_VERSION = 1;
export const LAYOUT_PACKAGE_MAX_COMPRESSED_BYTES = 2_097_152;
export const LAYOUT_PACKAGE_MAX_ENTRIES = 64;
export const LAYOUT_PACKAGE_MAX_UNCOMPRESSED_BYTES = 8_388_608;
export const LAYOUT_PACKAGE_MAX_IMAGE_BYTES = 1_048_576;
export const LAYOUT_PACKAGE_MAX_IMAGE_DIMENSION = 2048;
export const LAYOUT_PACKAGE_IMAGE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const CUSTOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

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

export function normalizePackageAssetPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/") || value.includes(":")) return null;
  const segments = value.split("/");
  if (segments.length < 2 || segments.length > 4 || segments[0] !== "assets" ||
    segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
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

function validAssetDescriptor(asset) {
  return normalizePackageAssetPath(asset?.path) === asset.path
    && LAYOUT_PACKAGE_IMAGE_MIME_TYPES.includes(asset.mimeType)
    && Number.isInteger(asset.sizeBytes) && asset.sizeBytes > 0 && asset.sizeBytes <= LAYOUT_PACKAGE_MAX_IMAGE_BYTES
    && Number.isInteger(asset.width) && asset.width > 0 && asset.width <= LAYOUT_PACKAGE_MAX_IMAGE_DIMENSION
    && Number.isInteger(asset.height) && asset.height > 0 && asset.height <= LAYOUT_PACKAGE_MAX_IMAGE_DIMENSION
    && DIGEST.test(asset.digest);
}

export function validateLayoutPackage(raw, assets) {
  if (!Array.isArray(assets) || assets.length === 0 || assets.length > LAYOUT_PACKAGE_MAX_ENTRIES - 2) {
    return { valid: false, code: "invalid-package-assets", error: "The layout package has an invalid asset inventory." };
  }
  const validation = validateImportedLayout(raw, { allowImages: true });
  if (!validation.valid) return validation;
  const inventory = new Map();
  const foldedPaths = new Set();
  for (const asset of assets) {
    const folded = asset?.path?.toLocaleLowerCase?.("en-US");
    if (!validAssetDescriptor(asset) || foldedPaths.has(folded)) {
      return { valid: false, code: "invalid-package-assets", error: "The layout package contains invalid or colliding assets." };
    }
    foldedPaths.add(folded);
    inventory.set(asset.path, Object.freeze({ ...asset }));
  }
  const references = [...new Set(collectLayoutImageReferences(validation.definition))];
  if (!references.length) {
    return { valid: false, code: "package-assets-unused", error: "The layout package does not reference its image assets." };
  }
  const normalizedReferences = [];
  for (const reference of references) {
    const path = normalizePackageAssetPath(reference);
    if (!path || !inventory.has(path)) {
      return { valid: false, code: "package-asset-unavailable", error: "A layout image is missing or outside the package assets directory." };
    }
    normalizedReferences.push(path);
  }
  if (new Set(normalizedReferences).size !== inventory.size) {
    return { valid: false, code: "package-assets-unused", error: "The layout package contains an unreferenced asset." };
  }
  return { ...validation, assets: [...inventory.values()] };
}

export function validateImportedLayout(raw, options = {}) {
  if (typeof raw !== "string") {
    return { valid: false, code: "invalid-content", error: "The selected layout is not text." };
  }
  if (encodedSize(raw) > CUSTOM_LAYOUT_MAX_BYTES) {
    return { valid: false, code: "document-too-large", error: "The selected layout is larger than 512 KiB." };
  }
  let definition;
  try {
    definition = JSON.parse(raw);
  } catch {
    return { valid: false, code: "invalid-json", error: "The selected file is not valid JSON." };
  }
  const validation = validateLayoutDefinition(definition);
  if (!validation.valid) return { valid: false, code: "invalid-layout", error: validation.error };
  if (!options.allowImages && importedImageReference(definition)) {
    return {
      valid: false,
      code: "image-assets-unsupported",
      error: "Standalone JSON supports textual legends only; use a .khlayout package for images.",
    };
  }
  return { valid: true, code: null, error: null, definition };
}

export async function sha256Hex(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle?.digest) throw new CustomLayoutError("digest-unavailable", "Layout verification is unavailable.");
  const bytes = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validRecordShape(record) {
  const legacy = record?.schemaVersion === LEGACY_CUSTOM_LAYOUT_RECORD_VERSION && !record.format && !record.assets;
  const packaged = record?.schemaVersion === CUSTOM_LAYOUT_RECORD_VERSION && record.format === "package"
    && Array.isArray(record.assets) && record.assets.length > 0 && record.assets.every(validAssetDescriptor);
  const standalone = record?.schemaVersion === CUSTOM_LAYOUT_RECORD_VERSION && record.format === "json"
    && (!record.assets || record.assets.length === 0);
  return (legacy || standalone || packaged)
    && CUSTOM_ID.test(record.id)
    && typeof record.name === "string" && record.name.trim().length > 0 && record.name.trim().length <= 80
    && record.normalizedName === normalizeCustomLayoutName(record.name)
    && DIGEST.test(record.digest)
    && typeof record.content === "string" && encodedSize(record.content) <= CUSTOM_LAYOUT_MAX_BYTES;
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
    this.randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.bundledDefinitions = options.bundledDefinitions ?? MOBILE_BUNDLED_LAYOUT_DEFINITIONS;
    this.bundledOrder = options.bundledOrder ?? MOBILE_BUNDLED_LAYOUT_ORDER;
    this.defaultLayoutKey = options.defaultLayoutKey ?? "qwerty";
    this.urlApi = options.urlApi ?? globalThis.URL;
    this.Blob = options.Blob ?? globalThis.Blob;
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

  async resolveRecord(record, validation) {
    if (record.format !== "package") return Object.freeze({ ...record, definition: validation.definition });
    const urls = new Map();
    try {
      for (const asset of validation.assets) {
        const response = await this.adapter.readAsset(record.id, asset.path);
        if (response?.mimeType !== asset.mimeType || !Array.isArray(response?.bytes) || response.bytes.length !== asset.sizeBytes) {
          throw new CustomLayoutError("package-asset-unavailable", "A stored package image could not be verified.");
        }
        const url = this.urlApi.createObjectURL(new this.Blob([new Uint8Array(response.bytes)], { type: asset.mimeType }));
        urls.set(asset.path, url);
      }
      this.assetUrls.set(record.id, urls);
      return Object.freeze({ ...record, definition: mapDefinitionImages(validation.definition, urls) });
    } catch (error) {
      for (const url of urls.values()) this.urlApi?.revokeObjectURL?.(url);
      throw error;
    }
  }

  async initialize() {
    if (!this.available) return { status: "unavailable", diagnostics: [] };
    this.dispose();
    const [loaded, saved] = await Promise.all([this.adapter.listRecords(), this.adapter.readSelection()]);
    const diagnostics = [...(loaded?.diagnostics ?? []), ...(saved?.diagnostic ? [saved.diagnostic] : [])];
    const records = [];
    for (const record of (loaded?.records ?? []).slice(0, CUSTOM_LAYOUT_MAX_RECORDS)) {
      if (!validRecordShape(record)) {
        diagnostics.push("A stored custom layout was skipped because its record is invalid.");
        continue;
      }
      const validation = record.format === "package"
        ? validateLayoutPackage(record.content, record.assets)
        : validateImportedLayout(record.content);
      const digest = validation.valid && record.format !== "package" ? await sha256Hex(record.content, this.crypto) : record.digest;
      if (!validation.valid || digest !== record.digest) {
        diagnostics.push(`${record.name}: stored content failed validation and was skipped.`);
        continue;
      }
      try {
        records.push(await this.resolveRecord(record, validation));
      } catch {
        diagnostics.push(`${record.name}: a stored package image was unavailable and the layout was skipped.`);
      }
    }
    this.records = records;
    this.diagnostics = diagnostics.map(diagnostic).slice(0, 8);
    const catalog = this.buildCatalog();
    const requested = validSelectionShape(saved?.selection) ? layoutKeyFromReference(saved.selection) : null;
    const selected = requested && Object.hasOwn(catalog.definitions, requested)
      ? requested
      : catalog.selectedLayoutKey;
    this.viewerModel.replaceCatalog(catalog, selected);
    if (selected && selected !== requested) await this.adapter.writeSelection(layoutReferenceFromKey(selected));
    return { status: "ready", selectedLayoutKey: selected, diagnostics: [...this.diagnostics] };
  }

  async selectLayout(layoutKey) {
    if (!Object.hasOwn(this.viewerModel.catalog.definitions, layoutKey)) {
      throw new CustomLayoutError("invalid-layout", "Choose an available layout.");
    }
    await this.adapter.writeSelection(layoutReferenceFromKey(layoutKey));
    return this.viewerModel.selectLayout(layoutKey);
  }

  async importLayout(confirmReplace = async () => false) {
    const picked = await this.adapter.pickLayout();
    if (picked?.cancelled) return { status: "cancelled" };
    const packaged = picked?.kind === "package";
    const validation = packaged
      ? validateLayoutPackage(picked?.content, picked?.assets)
      : validateImportedLayout(picked?.content);
    if (!validation.valid) {
      if (packaged && picked?.token) await this.adapter.discardPackage(picked.token).catch(() => {});
      throw new CustomLayoutError(validation.code, validation.error);
    }
    const digest = packaged ? picked?.digest : await sha256Hex(picked.content, this.crypto);
    if (!DIGEST.test(digest ?? "")) {
      if (packaged && picked?.token) await this.adapter.discardPackage(picked.token).catch(() => {});
      throw new CustomLayoutError("invalid-package-digest", "The layout package could not be verified.");
    }
    const duplicate = this.records.find((record) => record.digest === digest);
    if (duplicate) {
      if (packaged) await this.adapter.discardPackage(picked.token).catch(() => {});
      await this.selectLayout(`custom:${duplicate.id}`);
      return { status: "duplicate", record: duplicate };
    }
    const normalizedName = normalizeCustomLayoutName(validation.definition.name);
    const existing = this.records.find((record) => record.normalizedName === normalizedName);
    if (existing && !await confirmReplace(existing, validation.definition)) {
      if (packaged) await this.adapter.discardPackage(picked.token).catch(() => {});
      return { status: "cancelled-replacement", record: existing };
    }
    const stored = {
      schemaVersion: CUSTOM_LAYOUT_RECORD_VERSION,
      id: existing?.id ?? this.randomUUID(),
      name: validation.definition.name.trim(),
      normalizedName,
      digest,
      content: picked.content,
      format: packaged ? "package" : "json",
      assets: packaged ? validation.assets : [],
    };
    const previousSelection = layoutReferenceFromKey(this.viewerModel.snapshot().selectedLayoutKey);
    const nextSelection = layoutReferenceFromKey(`custom:${stored.id}`);
    try {
      await this.adapter.writeSelection(nextSelection);
    } catch (error) {
      if (packaged) await this.adapter.discardPackage(picked.token).catch(() => {});
      throw error;
    }
    try {
      if (packaged) await this.adapter.commitPackage(picked.token, stored);
      else await this.adapter.writeRecord(stored);
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
