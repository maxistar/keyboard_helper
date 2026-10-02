import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BUILTIN_LAYOUTS } from "../src/app_config.js";
import { calcCanvasGeometry } from "../src/layout_geometry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keySize = { w: 50, h: 40, gap: 10 };

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);
}

// Independent reference: rotate the four corners with a matrix instead of using half-extents.
function referenceBox(keys, size) {
  const gap = size.gap ?? 0;
  const xs = [];
  const ys = [];
  for (const key of keys) {
    const uw = key.w ?? 1;
    const uh = key.h ?? 1;
    const width = size.w * uw + gap * (uw - 1);
    const height = size.h * uh + gap * (uh - 1);
    const left = key.col * (size.w + gap);
    const top = key.row * (size.h + gap);
    const cx = left + width / 2;
    const cy = top + height / 2;
    const a = ((key.angle ?? 0) * Math.PI) / 180;
    for (const [dx, dy] of [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]) {
      xs.push(cx + dx * Math.cos(a) - dy * Math.sin(a));
      ys.push(cy + dx * Math.sin(a) + dy * Math.cos(a));
    }
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test("an unrotated layout has no tail beyond its last key", () => {
  const geometry = calcCanvasGeometry([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }], keySize);
  assert.deepEqual(geometry, { originX: 0, originY: 0, width: 110, height: 90 });
});

test("spans widen a key by whole steps minus the trailing gap", () => {
  const geometry = calcCanvasGeometry([{ row: 0, col: 0 }, { row: 0, col: 1, w: 2, h: 2 }], keySize);
  assert.deepEqual(geometry, { originX: 0, originY: 0, width: 50 + 10 + 110, height: 90 });
});

test("a layout that starts at a later column or row is drawn from its first key", () => {
  const geometry = calcCanvasGeometry([{ row: 1, col: 2 }, { row: 1, col: 3 }], keySize);
  assert.deepEqual(geometry, { originX: 120, originY: 50, width: 110, height: 40 });
});

test("a rotated key extends the canvas by its overshoot", () => {
  const key = { row: 0, col: 0, angle: 24 };
  const geometry = calcCanvasGeometry([key], keySize);
  const reference = referenceBox([key], keySize);
  close(geometry.originX, reference.minX, "originX");
  close(geometry.originY, reference.minY, "originY");
  close(geometry.width, reference.maxX - reference.minX, "width");
  close(geometry.height, reference.maxY - reference.minY, "height");
  assert.ok(geometry.originX < 0 && geometry.originY < 0, "the box starts above and left of the cell");
  assert.ok(geometry.width > keySize.w && geometry.height > keySize.h);
});

test("rotation by 90 degrees swaps the extents and a negative angle mirrors the overshoot", () => {
  const upright = calcCanvasGeometry([{ row: 0, col: 0 }], keySize);
  const turned = calcCanvasGeometry([{ row: 0, col: 0, angle: 90 }], keySize);
  close(turned.width, upright.height, "width");
  close(turned.height, upright.width, "height");
  const positive = calcCanvasGeometry([{ row: 0, col: 0, angle: 10 }], keySize);
  const negative = calcCanvasGeometry([{ row: 0, col: 0, angle: -10 }], keySize);
  close(positive.width, negative.width, "width");
  close(positive.originX, negative.originX, "originX");
});

test("margin grows every side and moves the origin by the same amount", () => {
  const plain = calcCanvasGeometry([{ row: 0, col: 1 }], keySize);
  const padded = calcCanvasGeometry([{ row: 0, col: 1 }], keySize, { margin: 6 });
  assert.equal(padded.originX, plain.originX - 6);
  assert.equal(padded.originY, plain.originY - 6);
  assert.equal(padded.width, plain.width + 12);
  assert.equal(padded.height, plain.height + 12);
});

test("empty and malformed inputs stay finite", () => {
  assert.deepEqual(calcCanvasGeometry([], keySize), { originX: 0, originY: 0, width: 0, height: 0 });
  const geometry = calcCanvasGeometry([{ row: 0, col: 0, w: -1, h: Number.NaN, angle: "x" }], { w: 50, h: 40 });
  assert.deepEqual(geometry, { originX: 0, originY: 0, width: 50, height: 40 });
});

function layoutSources() {
  const sources = Object.entries(BUILTIN_LAYOUTS).map(([key, metadata]) => [
    key,
    JSON.parse(readFileSync(path.join(root, "src", metadata.file), "utf8")),
  ]);
  const corney = path.resolve(root, "../corney/layout_corney.json");
  if (existsSync(corney)) sources.push(["corney", JSON.parse(readFileSync(corney, "utf8"))]);
  return sources;
}

test("every bundled layout fits its rotated keys exactly, with no leading or trailing space", () => {
  for (const [name, definition] of layoutSources()) {
    const keys = definition.keyPositions;
    const geometry = calcCanvasGeometry(keys, definition.keySize);
    const reference = referenceBox(keys, definition.keySize);
    const tolerance = 1e-6;
    assert.ok(Math.abs(geometry.originX - reference.minX) < tolerance, `${name} left edge`);
    assert.ok(Math.abs(geometry.originY - reference.minY) < tolerance, `${name} top edge`);
    assert.ok(Math.abs(geometry.originX + geometry.width - reference.maxX) < tolerance, `${name} right edge`);
    assert.ok(Math.abs(geometry.originY + geometry.height - reference.maxY) < tolerance, `${name} bottom edge`);
  }
});

test("the keys are centered as a block once drawn from the origin", () => {
  for (const [name, definition] of layoutSources()) {
    const keys = definition.keyPositions;
    const geometry = calcCanvasGeometry(keys, definition.keySize);
    const reference = referenceBox(keys, definition.keySize);
    const leftGap = reference.minX - geometry.originX;
    const rightGap = geometry.originX + geometry.width - reference.maxX;
    assert.ok(Math.abs(leftGap - rightGap) < 1e-6, `${name} left and right space match`);
  }
});
