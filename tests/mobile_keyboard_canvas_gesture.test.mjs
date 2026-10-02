import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasGestureBounds,
  constrainCanvasGesture,
  createCanvasGestureState,
  MAX_CANVAS_ZOOM,
  panCanvasGesture,
  resetCanvasGesture,
  zoomCanvasGesture,
} from "../src-mobile/keyboard_canvas_gesture.js";

const geometry = { canvasWidth: 300, canvasHeight: 200, viewportWidth: 300, viewportHeight: 200 };

test("canvas gestures clamp zoom and pan to fitted stage bounds", () => {
  const bounds = canvasGestureBounds({ ...geometry, zoom: 2 });
  assert.deepEqual(bounds, { zoom: 2, maxPanX: 150, maxPanY: 100 });
  assert.deepEqual(constrainCanvasGesture({ zoom: 9, panX: 999, panY: -999 }, geometry), {
    zoom: MAX_CANVAS_ZOOM, panX: 300, panY: -200,
  });
  assert.deepEqual(panCanvasGesture(createCanvasGestureState({ zoom: 1 }), { x: 12, y: -8 }, geometry), {
    zoom: 1, panX: 0, panY: 0,
  });
});

test("pinch zoom preserves the focal point and admits one-axis bounds", () => {
  const wide = { canvasWidth: 300, canvasHeight: 100, viewportWidth: 300, viewportHeight: 200 };
  const zoomed = zoomCanvasGesture(createCanvasGestureState(), {
    zoom: 2, fromPoint: { x: 210, y: 100 }, toPoint: { x: 210, y: 100 },
  }, geometry);
  assert.deepEqual(zoomed, { zoom: 2, panX: -60, panY: 0 });
  assert.deepEqual(panCanvasGesture({ zoom: 2, panX: 10, panY: 20 }, { x: 999, y: 999 }, wide), {
    zoom: 2, panX: 150, panY: 0,
  });
});

test("invalid bounds and cancellation reset safely to the fitted overview", () => {
  assert.equal(canvasGestureBounds({ canvasWidth: 0, canvasHeight: 1, viewportWidth: 1, viewportHeight: 1 }), null);
  assert.deepEqual(resetCanvasGesture(), { zoom: 1, panX: 0, panY: 0 });
});
