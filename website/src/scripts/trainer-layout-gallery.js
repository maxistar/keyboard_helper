import "../../../src/keyboard_viewer.js";
import { BUILTIN_LAYOUTS } from "../../../src/app_config.js";
import { buildLayout } from "../../../src/layout_catalog.js";
import { normalizeLayerData } from "../../../src/layout_semantics.js";

const layoutDefinitions = import.meta.glob("../../../src/layout_*.json", {
  eager: true,
  import: "default",
});

function definitionFor(fileName) {
  const entry = Object.entries(layoutDefinitions).find(([path]) => path.endsWith(`/${fileName}`));
  return entry?.[1] ?? null;
}

function fitPreview(stage, canvas, viewer) {
  const width = Number.parseFloat(viewer.style.width);
  const height = Number.parseFloat(viewer.style.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  const scale = Math.min(1, stage.clientWidth / width);
  viewer.style.position = "absolute";
  viewer.style.left = "0";
  viewer.style.top = "0";
  viewer.style.transformOrigin = "top left";
  viewer.style.transform = `scale(${scale})`;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  stage.style.height = `${height * scale}px`;
}

export function mountTrainerLayoutGallery(documentTarget = globalThis.document) {
  const viewers = [...documentTarget.querySelectorAll("keyboard-layout-viewer[data-layout-key]")];
  if (!viewers.length) return;

  const expectedKeys = Object.keys(BUILTIN_LAYOUTS).sort();
  const renderedKeys = viewers.map((viewer) => viewer.dataset.layoutKey).sort();
  if (expectedKeys.length !== renderedKeys.length || expectedKeys.some((key, index) => key !== renderedKeys[index])) {
    throw new Error("Trainer layout gallery does not match the built-in layout catalog.");
  }

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const viewer = target.querySelector("keyboard-layout-viewer[data-layout-key]");
      const canvas = target.querySelector(".layout-preview-canvas");
      if (viewer && canvas) fitPreview(target, canvas, viewer);
    }
  }) : null;

  for (const viewer of viewers) {
    const key = viewer.dataset.layoutKey;
    const layout = BUILTIN_LAYOUTS[key];
    const definition = layout ? definitionFor(layout.file) : null;
    if (!layout || !definition) throw new Error(`Missing built-in layout definition for ${key}.`);

    const { layers } = normalizeLayerData(definition.keyLayers);
    const presentation = buildLayout(definition, layers);
    viewer.setPresentation(presentation, {
      layerIndex: 0,
      layerAuthoritative: true,
      pressedPositions: [],
      comboPositions: [],
      interactive: false,
    });

    const canvas = viewer.parentElement;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) continue;
    canvas.style.position = "relative";
    fitPreview(stage, canvas, viewer);
    resizeObserver?.observe(stage);
  }
}
