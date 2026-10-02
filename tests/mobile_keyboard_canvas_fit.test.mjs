import assert from "node:assert/strict";
import test from "node:test";

import {
  fitKeyboardCanvas,
  KeyboardCanvasOrientation,
} from "../src-mobile/keyboard_canvas_fit.js";

test("landscape fitting preserves native axes and uniformly fits both bounds", () => {
  const fit = fitKeyboardCanvas({
    canvasWidth: 1000,
    canvasHeight: 250,
    viewportWidth: 600,
    viewportHeight: 300,
  });
  assert.deepEqual(fit, {
    orientation: KeyboardCanvasOrientation.LANDSCAPE,
    rotationDegrees: 0,
    scale: 0.6,
    displayedWidth: 600,
    displayedHeight: 150,
    canvasWidth: 1000,
    canvasHeight: 250,
  });
});

test("portrait fitting exchanges canvas axes and rotates the full overview", () => {
  const fit = fitKeyboardCanvas({
    canvasWidth: 1000,
    canvasHeight: 250,
    viewportWidth: 320,
    viewportHeight: 640,
    orientation: KeyboardCanvasOrientation.PORTRAIT,
  });
  assert.equal(fit.rotationDegrees, 90);
  assert.equal(fit.scale, 0.64);
  assert.equal(fit.displayedWidth, 160);
  assert.equal(fit.displayedHeight, 640);
});

test("square and short stages use the smaller axis ratio without distortion", () => {
  const square = fitKeyboardCanvas({
    canvasWidth: 400,
    canvasHeight: 200,
    viewportWidth: 200,
    viewportHeight: 200,
  });
  assert.equal(square.scale, 0.5);
  assert.equal(square.displayedWidth, 200);
  assert.equal(square.displayedHeight, 100);

  const shortPortrait = fitKeyboardCanvas({
    canvasWidth: 1000,
    canvasHeight: 250,
    viewportWidth: 320,
    viewportHeight: 420,
    orientation: KeyboardCanvasOrientation.PORTRAIT,
  });
  assert.equal(shortPortrait.scale, 0.42);
  assert.equal(shortPortrait.displayedWidth, 105);
  assert.equal(shortPortrait.displayedHeight, 420);
});

test("fractional geometry remains finite and invalid measurements are rejected", () => {
  const fractional = fitKeyboardCanvas({
    canvasWidth: 333.5,
    canvasHeight: 117.25,
    viewportWidth: 279.5,
    viewportHeight: 512.25,
  });
  assert.ok(Number.isFinite(fractional.scale));
  assert.ok(fractional.displayedWidth <= 279.5);
  assert.ok(fractional.displayedHeight <= 512.25);

  for (const value of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(fitKeyboardCanvas({ canvasWidth: value, canvasHeight: 1, viewportWidth: 1, viewportHeight: 1 }), null);
  }
  assert.equal(fitKeyboardCanvas({ canvasWidth: 1, canvasHeight: 1, viewportWidth: 1, viewportHeight: 1, orientation: "diagonal" }), null);
});
