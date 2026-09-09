import { MOBILE_BUNDLED_LAYOUT_DEFINITIONS } from "./bundled_layout_definitions.js";
import { createLayoutPresentation } from "./layout_viewer_model.js";
import { TelemetryStatus } from "./telemetry_session.js";

export const LayoutPresentationMode = Object.freeze({ BROWSE: "browse", LIVE: "live" });
export const PRESENTATION_MISMATCH_LIMIT = 4;

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function mismatch(kind, values = {}) {
  return Object.freeze({ kind, ...values });
}

export function resolveMobileLayoutPresentation(
  browse,
  telemetry,
  requestedMode = LayoutPresentationMode.BROWSE,
  definitions = MOBILE_BUNDLED_LAYOUT_DEFINITIONS,
) {
  if (!browse || !telemetry) throw new TypeError("Browse and telemetry snapshots are required.");
  const liveAvailable = telemetry.status === TelemetryStatus.LIVE;
  const mode = requestedMode === LayoutPresentationMode.LIVE && liveAvailable
    ? LayoutPresentationMode.LIVE
    : LayoutPresentationMode.BROWSE;
  if (mode === LayoutPresentationMode.BROWSE || !browse.presentation || !browse.selectedLayoutKey) {
    return freeze({
      mode: LayoutPresentationMode.BROWSE,
      requestedMode,
      liveAvailable,
      selectedLayoutKey: browse.selectedLayoutKey,
      selectedLayerIndex: browse.selectedLayerIndex,
      activeLayer: null,
      layerAuthoritative: false,
      presentation: browse.presentation,
      pressedPositions: [],
      comboPositions: [],
      activeCombos: [],
      mismatches: [],
      telemetryStatus: telemetry.status,
      telemetryReason: telemetry.reason,
      diagnostics: telemetry.diagnostics,
    });
  }

  const definition = definitions[browse.selectedLayoutKey];
  const mismatches = [];
  let selectedLayerIndex = browse.selectedLayerIndex;
  let presentation = browse.presentation;
  if (telemetry.layerAuthoritative && Number.isInteger(telemetry.activeLayer)) {
    if (telemetry.activeLayer >= 0 && telemetry.activeLayer < browse.presentation.layers.length && definition) {
      selectedLayerIndex = telemetry.activeLayer;
      presentation = createLayoutPresentation(definition, telemetry.activeLayer);
    } else {
      mismatches.push(mismatch("layer", { layer: telemetry.activeLayer }));
    }
  }

  const validPosition = (position) => Number.isInteger(position)
    && position >= 0 && position < presentation.keys.length;
  const pressedPositions = [];
  for (const position of telemetry.pressedPositions) {
    if (validPosition(position)) pressedPositions.push(position);
    else mismatches.push(mismatch("position", { position }));
  }

  const comboPositions = new Set();
  const activeCombos = [];
  for (const active of telemetry.activeCombos) {
    const metadata = definition?.combos?.find(({ id }) => id === active.comboId) ?? null;
    const positionsMatch = metadata
      && metadata.positions.length === active.positions.length
      && metadata.positions.every((position, index) => position === active.positions[index]);
    if (!metadata || !positionsMatch) mismatches.push(mismatch("combo", { comboId: active.comboId }));
    for (const position of active.positions) {
      if (validPosition(position)) comboPositions.add(position);
      else mismatches.push(mismatch("position", { position }));
    }
    activeCombos.push({
      comboId: active.comboId,
      label: positionsMatch ? String(metadata.code ?? `Combo ${active.comboId}`) : `Combo ${active.comboId}`,
      matched: Boolean(positionsMatch),
      positions: active.positions.filter(validPosition),
      contextualLayer: active.layer,
    });
  }

  return freeze({
    mode,
    requestedMode,
    liveAvailable,
    selectedLayoutKey: browse.selectedLayoutKey,
    selectedLayerIndex,
    activeLayer: telemetry.activeLayer,
    layerAuthoritative: telemetry.layerAuthoritative,
    presentation,
    pressedPositions: [...new Set(pressedPositions)].sort((left, right) => left - right),
    comboPositions: [...comboPositions].sort((left, right) => left - right),
    activeCombos,
    mismatches: mismatches.slice(0, PRESENTATION_MISMATCH_LIMIT),
    telemetryStatus: telemetry.status,
    telemetryReason: telemetry.reason,
    diagnostics: telemetry.diagnostics,
  });
}

export class MobileLayoutPresentationController {
  constructor(browseModel, telemetryController, options = {}) {
    if (!browseModel?.snapshot || !browseModel?.subscribe || !telemetryController?.snapshot || !telemetryController?.subscribe) {
      throw new TypeError("Browse and telemetry models are required.");
    }
    this.browseModel = browseModel;
    this.telemetryController = telemetryController;
    this.definitions = options.definitions ?? MOBILE_BUNDLED_LAYOUT_DEFINITIONS;
    this.listeners = new Set();
    this.requestedMode = LayoutPresentationMode.BROWSE;
    this.wasLiveAvailable = false;
    this.state = resolveMobileLayoutPresentation(
      browseModel.snapshot(), telemetryController.snapshot(), this.requestedMode, this.definitions,
    );
    this.unsubscribeBrowse = browseModel.subscribe(() => this.refresh());
    this.unsubscribeTelemetry = telemetryController.subscribe((telemetry) => {
      const available = telemetry.status === TelemetryStatus.LIVE;
      if (available && !this.wasLiveAvailable) this.requestedMode = LayoutPresentationMode.LIVE;
      this.wasLiveAvailable = available;
      this.refresh();
    });
  }

  snapshot() { return this.state; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  refresh() {
    this.state = resolveMobileLayoutPresentation(
      this.browseModel.snapshot(),
      this.telemetryController.snapshot(),
      this.requestedMode,
      this.definitions,
    );
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  selectMode(mode) {
    if (!Object.values(LayoutPresentationMode).includes(mode)) throw new TypeError("Unknown layout presentation mode.");
    this.requestedMode = mode;
    return this.refresh();
  }

  dispose() {
    this.unsubscribeBrowse?.();
    this.unsubscribeTelemetry?.();
    this.listeners.clear();
  }
}
