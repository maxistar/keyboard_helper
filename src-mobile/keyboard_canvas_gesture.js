export const MIN_CANVAS_ZOOM = 1;
export const MAX_CANVAS_ZOOM = 3;

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finite(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function createCanvasGestureState({ zoom = MIN_CANVAS_ZOOM, panX = 0, panY = 0 } = {}) {
  return Object.freeze({
    zoom: clamp(finite(zoom, MIN_CANVAS_ZOOM), MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM),
    panX: normalizeZero(finite(panX)),
    panY: normalizeZero(finite(panY)),
  });
}

export function canvasGestureBounds({ canvasWidth, canvasHeight, viewportWidth, viewportHeight, zoom = MIN_CANVAS_ZOOM } = {}) {
  if (![canvasWidth, canvasHeight, viewportWidth, viewportHeight].every(finitePositive)) return null;
  const normalizedZoom = clamp(finite(zoom, MIN_CANVAS_ZOOM), MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
  return Object.freeze({
    zoom: normalizedZoom,
    maxPanX: Math.max(0, (canvasWidth * normalizedZoom - viewportWidth) / 2),
    maxPanY: Math.max(0, (canvasHeight * normalizedZoom - viewportHeight) / 2),
  });
}

export function constrainCanvasGesture(state, geometry) {
  const bounds = canvasGestureBounds({ ...geometry, zoom: state?.zoom });
  if (!bounds) return createCanvasGestureState();
  return createCanvasGestureState({
    zoom: bounds.zoom,
    panX: clamp(finite(state?.panX), -bounds.maxPanX, bounds.maxPanX),
    panY: clamp(finite(state?.panY), -bounds.maxPanY, bounds.maxPanY),
  });
}

export function panCanvasGesture(state, delta, geometry) {
  return constrainCanvasGesture({
    ...state,
    panX: finite(state?.panX) + finite(delta?.x),
    panY: finite(state?.panY) + finite(delta?.y),
  }, geometry);
}

export function zoomCanvasGesture(state, { zoom, fromPoint, toPoint = fromPoint } = {}, geometry) {
  const previous = constrainCanvasGesture(state, geometry);
  const nextZoom = clamp(finite(zoom, previous.zoom), MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
  const ratio = nextZoom / previous.zoom;
  const centerX = finite(geometry?.viewportWidth) / 2;
  const centerY = finite(geometry?.viewportHeight) / 2;
  const fromX = finite(fromPoint?.x, centerX);
  const fromY = finite(fromPoint?.y, centerY);
  const toX = finite(toPoint?.x, fromX);
  const toY = finite(toPoint?.y, fromY);
  return constrainCanvasGesture({
    zoom: nextZoom,
    panX: toX - centerX - ratio * (fromX - centerX - previous.panX),
    panY: toY - centerY - ratio * (fromY - centerY - previous.panY),
  }, geometry);
}

export function resetCanvasGesture() {
  return createCanvasGestureState();
}
