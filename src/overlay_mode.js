export const MINI_TARGET_SCALE = 0.65;

export const OVERLAY_MODES = Object.freeze({
  FULL: "full",
  ENTERING_MINI: "entering-mini",
  MINI: "mini",
  RESTORING_FULL: "restoring-full",
});

/**
 * @typedef {typeof OVERLAY_MODES[keyof typeof OVERLAY_MODES]} OverlayMode
 * @typedef {{ width: number, height: number }} MeasuredContentBounds
 * @typedef {{ contentWidth: number, contentHeight: number, targetScale: number }} MiniGeometryRequest
 * @typedef {{ scale?: number, decorations?: boolean, [key: string]: unknown }} MiniGeometryResult
 * @typedef {(request: MiniGeometryRequest) => Promise<MiniGeometryResult>} MiniGeometryCommand
 * @typedef {() => Promise<MiniGeometryResult>} RestoreGeometryCommand
 * @typedef {() => MeasuredContentBounds} MeasureContent
 * @typedef {(mode: OverlayMode, geometry?: MiniGeometryResult | null) => void} ApplyMode
 * @typedef {(mode: OverlayMode, geometry?: MiniGeometryResult | null) => void} SetDecorationMode
 * @typedef {(message: string) => void} ReportError
 * @typedef {(mode: OverlayMode) => void} ModeChangeHandler
 * @typedef {{ enterNative: MiniGeometryCommand, updateNative: MiniGeometryCommand, restoreNative: RestoreGeometryCommand, measureContent: MeasureContent, applyMode: ApplyMode, setDecorationMode?: SetDecorationMode, reportError?: ReportError, onChange?: ModeChangeHandler }} OverlayModeControllerOptions
 * @typedef {{ getMode(): OverlayMode, enterMini(): Promise<boolean>, restoreFull(): Promise<boolean>, refreshMiniGeometry(): Promise<boolean> }} OverlayModeController
 * @typedef {{ body: HTMLElement, stage: HTMLElement, layout: HTMLElement, restoreButton: HTMLElement }} OverlayModeViewOptions
 * @typedef {{ measureContent: MeasureContent, applyMode: ApplyMode }} OverlayModeView
 */

/**
 * @param {unknown} error
 * @param {string} fallback
 */
function messageFrom(error, fallback) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

/**
 * @param {OverlayModeControllerOptions} options
 * @returns {OverlayModeController}
 */
export function createOverlayModeController({
  enterNative,
  updateNative,
  restoreNative,
  measureContent,
  applyMode,
  setDecorationMode = () => {},
  reportError = () => {},
  onChange = () => {},
}) {
  /** @type {OverlayMode} */
  let mode = OVERLAY_MODES.FULL;

  /**
   * @param {OverlayMode} nextMode
   * @param {MiniGeometryResult | null} [details]
   */
  function setMode(nextMode, details = null) {
    mode = nextMode;
    applyMode(nextMode, details);
    onChange(nextMode);
  }

  async function enterMini() {
    if (mode !== OVERLAY_MODES.FULL) return mode === OVERLAY_MODES.MINI;

    setMode(OVERLAY_MODES.ENTERING_MINI);
    setDecorationMode(OVERLAY_MODES.ENTERING_MINI);
    try {
      const bounds = measureContent();
      const geometry = await enterNative({
        contentWidth: bounds.width,
        contentHeight: bounds.height,
        targetScale: MINI_TARGET_SCALE,
      });
      setMode(OVERLAY_MODES.MINI, geometry);
      setDecorationMode(OVERLAY_MODES.MINI, geometry);
      return true;
    } catch (error) {
      try {
        await restoreNative();
      } catch (rollbackError) {
        console.error("Failed to roll back mini overlay geometry:", rollbackError);
      }
      setMode(OVERLAY_MODES.FULL);
      setDecorationMode(OVERLAY_MODES.FULL, { decorations: true });
      reportError(messageFrom(error, "Failed to enter Mini Mode."));
      return false;
    }
  }

  async function restoreFull() {
    if (mode !== OVERLAY_MODES.MINI) return mode === OVERLAY_MODES.FULL;

    setMode(OVERLAY_MODES.RESTORING_FULL);
    try {
      const geometry = await restoreNative();
      setMode(OVERLAY_MODES.FULL, geometry);
      setDecorationMode(OVERLAY_MODES.FULL, geometry);
      return true;
    } catch (error) {
      setMode(OVERLAY_MODES.MINI);
      setDecorationMode(OVERLAY_MODES.MINI);
      reportError(messageFrom(error, "Failed to restore the full-size overlay."));
      return false;
    }
  }

  async function refreshMiniGeometry() {
    if (mode !== OVERLAY_MODES.MINI) return false;
    try {
      const bounds = measureContent();
      const geometry = await updateNative({
        contentWidth: bounds.width,
        contentHeight: bounds.height,
        targetScale: MINI_TARGET_SCALE,
      });
      applyMode(OVERLAY_MODES.MINI, geometry);
      return true;
    } catch (error) {
      reportError(messageFrom(error, "Failed to resize the Mini Mode overlay."));
      return false;
    }
  }

  setMode(OVERLAY_MODES.FULL);

  return {
    getMode: () => mode,
    enterMini,
    restoreFull,
    refreshMiniGeometry,
  };
}

/**
 * @param {OverlayModeViewOptions} options
 * @returns {OverlayModeView}
 */
export function createOverlayModeView({ body, stage, layout, restoreButton }) {
  function measureContent() {
    const width = layout.offsetWidth || Number.parseFloat(layout.style.width) || 1;
    const height = layout.offsetHeight || Number.parseFloat(layout.style.height) || 1;
    return { width, height };
  }

  /**
   * @param {OverlayMode} mode
   * @param {MiniGeometryResult | null} [geometry]
   */
  function applyMode(mode, geometry = null) {
    body.dataset.overlayMode = mode;
    const miniVisible = mode === OVERLAY_MODES.MINI || mode === OVERLAY_MODES.RESTORING_FULL;
    body.classList.toggle("mini-mode", miniVisible);
    body.classList.toggle("mini-transition", mode === OVERLAY_MODES.ENTERING_MINI);
    restoreButton.hidden = !miniVisible;

    if (geometry?.scale) {
      stage.style.setProperty("--mini-scale", String(geometry.scale));
      stage.parentElement?.style.setProperty(
        "--mini-stage-width",
        `${Math.ceil(measureContent().width * geometry.scale)}px`,
      );
      stage.parentElement?.style.setProperty(
        "--mini-stage-height",
        `${Math.ceil(measureContent().height * geometry.scale)}px`,
      );
    }
  }

  return { measureContent, applyMode };
}
