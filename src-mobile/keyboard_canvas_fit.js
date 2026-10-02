export const KeyboardCanvasOrientation = Object.freeze({
  LANDSCAPE: "landscape",
  PORTRAIT: "portrait",
});

function positiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Derive the visual bounds of a physical keyboard canvas inside a measured mobile stage.
 * Portrait reserves the canvas' rotated dimensions; landscape preserves authored geometry.
 */
export function fitKeyboardCanvas({
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  orientation = KeyboardCanvasOrientation.LANDSCAPE,
} = {}) {
  if (![canvasWidth, canvasHeight, viewportWidth, viewportHeight].every(positiveFinite)) return null;
  if (!Object.values(KeyboardCanvasOrientation).includes(orientation)) return null;

  const portrait = orientation === KeyboardCanvasOrientation.PORTRAIT;
  const unscaledWidth = portrait ? canvasHeight : canvasWidth;
  const unscaledHeight = portrait ? canvasWidth : canvasHeight;
  const scale = Math.min(viewportWidth / unscaledWidth, viewportHeight / unscaledHeight);
  if (!positiveFinite(scale)) return null;

  return Object.freeze({
    orientation,
    rotationDegrees: portrait ? 90 : 0,
    scale,
    displayedWidth: unscaledWidth * scale,
    displayedHeight: unscaledHeight * scale,
    canvasWidth,
    canvasHeight,
  });
}
