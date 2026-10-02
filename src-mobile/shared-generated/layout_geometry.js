// Shared by the desktop overlay and the mobile companion (copied to src-mobile/shared-generated/
// by `npm run sync:mobile-layouts`). Pure: no DOM, no layout parsing.

function span(units) {
  return Number.isFinite(units) && units > 0 ? units : 1;
}

/**
 * Bounding box of the drawn keys, in the layout's own key coordinates.
 *
 * Each key is the cell at `col * (w + gap)`, `row * (h + gap)` sized by its spans and rotated by
 * `angle` degrees about its center (the CSS default), so the box includes the overshoot of
 * rotated keys. `originX`/`originY` are the box's top-left in that coordinate system (they can be
 * negative or non-zero); a key is drawn at `cell - origin`. `margin` grows the box evenly on all
 * sides for decorations that are drawn outside the keys.
 */
export function calcCanvasGeometry(keys, keySize, { margin = 0 } = {}) {
  const gap = Number.isFinite(keySize.gap) ? keySize.gap : 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of keys) {
    const unitsW = span(key.w);
    const unitsH = span(key.h);
    const width = keySize.w * unitsW + gap * (unitsW - 1);
    const height = keySize.h * unitsH + gap * (unitsH - 1);
    const centerX = key.col * (keySize.w + gap) + width / 2;
    const centerY = key.row * (keySize.h + gap) + height / 2;
    const radians = (Number.isFinite(key.angle) ? key.angle : 0) * (Math.PI / 180);
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const halfWidth = (width * cos + height * sin) / 2;
    const halfHeight = (width * sin + height * cos) / 2;
    minX = Math.min(minX, centerX - halfWidth);
    maxX = Math.max(maxX, centerX + halfWidth);
    minY = Math.min(minY, centerY - halfHeight);
    maxY = Math.max(maxY, centerY + halfHeight);
  }
  if (!Number.isFinite(minX)) return { originX: 0, originY: 0, width: 0, height: 0 };
  return {
    originX: minX - margin,
    originY: minY - margin,
    width: maxX - minX + 2 * margin,
    height: maxY - minY + 2 * margin,
  };
}
