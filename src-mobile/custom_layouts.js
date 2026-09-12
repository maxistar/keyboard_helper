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

export const CUSTOM_LAYOUT_RECORD_VERSION = 1;
export const SELECTED_LAYOUT_VERSION = 1;
export const CUSTOM_LAYOUT_MAX_BYTES = 524_288;
export const CUSTOM_LAYOUT_MAX_RECORDS = 128;
export const CUSTOM_LAYOUT_DIAGNOSTIC_LIMIT = 180;
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

export function validateImportedLayout(raw) {
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
  if (importedImageReference(definition)) {
    return {
      valid: false,
      code: "image-assets-unsupported",
      error: "Custom layout import currently supports textual legends only; remove image references.",
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
  return record?.schemaVersion === CUSTOM_LAYOUT_RECORD_VERSION
    && CUSTOM_ID.test(record.id)
    && typeof record.name === "string" && record.name.trim().length > 0 && record.name.trim().length <= 80
    && record.normalizedName === normalizeCustomLayoutName(record.name)
    && DIGEST.test(record.digest)
    && typeof record.content === "string" && encodedSize(record.content) <= CUSTOM_LAYOUT_MAX_BYTES;
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
    this.records = [];
    this.diagnostics = [];
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

  async initialize() {
    if (!this.available) return { status: "unavailable", diagnostics: [] };
    const [loaded, saved] = await Promise.all([this.adapter.listRecords(), this.adapter.readSelection()]);
    const diagnostics = [...(loaded?.diagnostics ?? []), ...(saved?.diagnostic ? [saved.diagnostic] : [])];
    const records = [];
    for (const record of (loaded?.records ?? []).slice(0, CUSTOM_LAYOUT_MAX_RECORDS)) {
      if (!validRecordShape(record)) {
        diagnostics.push("A stored custom layout was skipped because its record is invalid.");
        continue;
      }
      const validation = validateImportedLayout(record.content);
      const digest = validation.valid ? await sha256Hex(record.content, this.crypto) : null;
      if (!validation.valid || digest !== record.digest) {
        diagnostics.push(`${record.name}: stored content failed validation and was skipped.`);
        continue;
      }
      records.push(Object.freeze({ ...record, definition: validation.definition }));
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
    const validation = validateImportedLayout(picked?.content);
    if (!validation.valid) throw new CustomLayoutError(validation.code, validation.error);
    const digest = await sha256Hex(picked.content, this.crypto);
    const duplicate = this.records.find((record) => record.digest === digest);
    if (duplicate) {
      await this.selectLayout(`custom:${duplicate.id}`);
      return { status: "duplicate", record: duplicate };
    }
    const normalizedName = normalizeCustomLayoutName(validation.definition.name);
    const existing = this.records.find((record) => record.normalizedName === normalizedName);
    if (existing && !await confirmReplace(existing, validation.definition)) return { status: "cancelled-replacement", record: existing };
    const record = Object.freeze({
      schemaVersion: CUSTOM_LAYOUT_RECORD_VERSION,
      id: existing?.id ?? this.randomUUID(),
      name: validation.definition.name.trim(),
      normalizedName,
      digest,
      content: picked.content,
      definition: validation.definition,
    });
    const stored = { ...record };
    delete stored.definition;
    const previous = existing ? { ...existing } : null;
    if (previous) delete previous.definition;
    await this.adapter.writeRecord(stored);
    try {
      await this.adapter.writeSelection(layoutReferenceFromKey(`custom:${record.id}`));
    } catch (error) {
      if (previous) await this.adapter.writeRecord(previous);
      else await this.adapter.removeRecord(record.id);
      throw error;
    }
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
    this.records = this.records.filter(({ id }) => id !== record.id);
    const catalog = this.buildCatalog();
    const next = selected ? catalog.selectedLayoutKey : this.viewerModel.snapshot().selectedLayoutKey;
    this.viewerModel.replaceCatalog(catalog, next);
    return { status: "removed", selectedLayoutKey: next };
  }
}
