import {
  MOBILE_BUNDLED_LAYOUT_DEFINITIONS,
  MOBILE_BUNDLED_LAYOUT_ORDER,
} from "./bundled_layout_definitions.js";
import {
  effectiveLayerEntry,
  normalizeKeyEntry,
  normalizeLayerData,
  validateLayoutDefinition,
} from "./layout_semantics.generated.js";

export const ViewerCatalogStatus = Object.freeze({ READY: "ready", EMPTY: "empty" });
export const VIEWER_DIAGNOSTIC_LIMIT = 180;

export class LayoutViewerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LayoutViewerError";
    this.code = code;
  }
}

function boundedDiagnostic(value) {
  const text = String(value ?? "Layout unavailable.").replace(/\s+/g, " ").trim();
  return text.length <= VIEWER_DIAGNOSTIC_LIMIT
    ? text
    : `${text.slice(0, VIEWER_DIAGNOSTIC_LIMIT - 1)}…`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function viewerEntryPresentation(entry) {
  const normalized = normalizeKeyEntry(entry);
  const richLabel = normalized.label && typeof normalized.label === "object"
    ? normalized.label
    : null;
  const label = richLabel ? richLabel.text : normalized.label;
  return {
    label: label ?? null,
    code: normalized.code,
    image: richLabel?.image ?? null,
    alt: richLabel?.alt ?? (label == null ? null : String(label)),
  };
}

export function createMobileLayoutCatalog({
  definitions = MOBILE_BUNDLED_LAYOUT_DEFINITIONS,
  order = MOBILE_BUNDLED_LAYOUT_ORDER,
  defaultLayoutKey = "qwerty",
} = {}) {
  const validDefinitions = {};
  const layouts = [];
  const diagnostics = [];
  for (const key of [...new Set(order)]) {
    const definition = definitions[key];
    const validation = validateLayoutDefinition(definition);
    if (!validation.valid) {
      diagnostics.push(boundedDiagnostic(`${key}: ${validation.error}`));
      continue;
    }
    const layerData = normalizeLayerData(definition.keyLayers);
    validDefinitions[key] = definition;
    layouts.push({
      key,
      name: definition.name.trim(),
      layerCount: layerData.layers.length,
      layerNames: [...layerData.names],
    });
  }
  const selectedLayoutKey = Object.hasOwn(validDefinitions, defaultLayoutKey)
    ? defaultLayoutKey
    : layouts[0]?.key ?? null;
  return deepFreeze({
    status: layouts.length ? ViewerCatalogStatus.READY : ViewerCatalogStatus.EMPTY,
    layouts,
    selectedLayoutKey,
    diagnostics: diagnostics.slice(0, 8),
    definitions: validDefinitions,
  });
}

export function createLayoutPresentation(definition, layerIndex = 0) {
  const validation = validateLayoutDefinition(definition);
  if (!validation.valid) throw new LayoutViewerError("invalid-layout", validation.error);
  const layerData = normalizeLayerData(definition.keyLayers);
  if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= layerData.layers.length) {
    throw new LayoutViewerError("invalid-layer", "The selected layer is not available.");
  }
  const gap = Number.isFinite(definition.keySize.gap) ? definition.keySize.gap : 0;
  let maxCol = 0;
  let maxRow = 0;
  const keys = definition.keyPositions.map((position, index) => {
    const widthUnits = Number.isFinite(position.w) && position.w > 0 ? position.w : 1;
    const heightUnits = Number.isFinite(position.h) && position.h > 0 ? position.h : 1;
    maxCol = Math.max(maxCol, position.col + widthUnits);
    maxRow = Math.max(maxRow, position.row + heightUnits);
    const entry = viewerEntryPresentation(effectiveLayerEntry(layerData.layers, layerIndex, index));
    const accessibleLabel = String(entry.alt ?? entry.label ?? entry.code ?? `Key ${index + 1}`);
    return {
      index,
      row: position.row,
      col: position.col,
      widthUnits,
      heightUnits,
      angle: Number.isFinite(position.angle) ? position.angle : 0,
      kind: typeof position.cls === "string" ? position.cls : "",
      label: entry.label == null ? "" : String(entry.label),
      code: entry.code == null ? null : String(entry.code),
      image: entry.image == null ? null : String(entry.image),
      accessibleLabel,
    };
  });
  return deepFreeze({
    name: definition.name.trim(),
    layerIndex,
    layerName: layerData.names[layerIndex],
    layers: layerData.names.map((name, index) => ({ index, name, key: layerData.layerKeys[index] })),
    keySize: { w: definition.keySize.w, h: definition.keySize.h, gap },
    width: maxCol * (definition.keySize.w + gap) + definition.keySize.w,
    height: maxRow * (definition.keySize.h + gap) + definition.keySize.h,
    keys,
  });
}

function freezeViewerSnapshot(value) {
  return deepFreeze({
    catalogStatus: value.catalogStatus,
    layouts: value.layouts.map((layout) => ({ ...layout, layerNames: [...layout.layerNames] })),
    selectedLayoutKey: value.selectedLayoutKey,
    selectedLayerIndex: value.selectedLayerIndex,
    diagnostics: [...value.diagnostics],
    presentation: value.presentation,
  });
}

export class MobileLayoutViewerModel {
  constructor(options = {}) {
    this.catalog = createMobileLayoutCatalog(options);
    this.listeners = new Set();
    this.state = this.buildSnapshot(this.catalog.selectedLayoutKey, 0);
  }

  buildSnapshot(layoutKey, layerIndex) {
    const definition = layoutKey ? this.catalog.definitions[layoutKey] : null;
    return freezeViewerSnapshot({
      catalogStatus: this.catalog.status,
      layouts: this.catalog.layouts,
      selectedLayoutKey: layoutKey,
      selectedLayerIndex: definition ? layerIndex : 0,
      diagnostics: this.catalog.diagnostics,
      presentation: definition ? createLayoutPresentation(definition, layerIndex) : null,
    });
  }

  snapshot() { return this.state; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  publish(next) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  selectLayout(layoutKey) {
    if (!Object.hasOwn(this.catalog.definitions, layoutKey)) {
      throw new LayoutViewerError("invalid-layout", "Choose an available bundled layout.");
    }
    if (layoutKey === this.state.selectedLayoutKey && this.state.selectedLayerIndex === 0) return this.state;
    return this.publish(this.buildSnapshot(layoutKey, 0));
  }

  selectLayer(layerIndex) {
    if (!this.state.selectedLayoutKey || !Number.isInteger(layerIndex) ||
      layerIndex < 0 || layerIndex >= this.state.presentation.layers.length) {
      throw new LayoutViewerError("invalid-layer", "Choose an available layer.");
    }
    if (layerIndex === this.state.selectedLayerIndex) return this.state;
    return this.publish(this.buildSnapshot(this.state.selectedLayoutKey, layerIndex));
  }
}
