import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BUILTIN_LAYOUTS } from "../src/app_config.js";
import {
  effectiveLayerEntry,
  normalizeKeyEntry,
  normalizeLayerData,
} from "../src/layout_catalog.js";
import {
  MOBILE_BUNDLED_LAYOUT_DEFINITIONS,
  MOBILE_BUNDLED_LAYOUT_ORDER,
} from "../src-mobile/bundled_layout_definitions.js";
import { createMobileLayoutViewerView } from "../src-mobile/layout_viewer.js";
import {
  createLayoutPresentation,
  createMobileLayoutCatalog,
  LayoutViewerError,
  MobileLayoutViewerModel,
  ViewerCatalogStatus,
  VIEWER_DIAGNOSTIC_LIMIT,
} from "../src-mobile/layout_viewer_model.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class StyleStub {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
}

class ElementStub {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.listeners = new Map();
    this.style = new StyleStub();
    this.textContent = "";
    this.value = "";
    this.bounds = { width: 0, height: 0 };
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener({ target: this, ...event }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getBoundingClientRect() { return { ...this.bounds }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function viewHarness(model = new MobileLayoutViewerModel(), { portrait = false } = {}) {
  const ids = [
    "viewer-layout", "viewer-layer-field", "viewer-layer", "viewer-live-layer", "viewer-live-layer-name",
    "viewer-diagnostic",
    "viewer-scroller", "viewer-gesture", "viewer-canvas", "viewer-keyboard", "viewer-empty",
    "viewer-live-switch", "viewer-stream-status",
    "viewer-combo-status", "viewer-telemetry-guidance",
    "viewer-import-layout", "viewer-remove-controls", "viewer-remove-target",
    "viewer-remove-layout", "viewer-layout-status",
  ];
  const elements = new Map(ids.map((id) => [id, new ElementStub(id === "viewer-layout" || id === "viewer-layer" || id.includes("target") ? "select" : "div")]));
  const document = {
    createElement: (tagName) => new ElementStub(tagName),
    getElementById: (id) => elements.get(id) ?? null,
  };
  elements.get("viewer-scroller").bounds = portrait
    ? { width: 320, height: 640 }
    : { width: 640, height: 320 };
  const orientationListeners = new Set();
  const orientationMedia = {
    matches: portrait,
    addEventListener(type, listener) { if (type === "change") orientationListeners.add(listener); },
    removeEventListener(type, listener) { if (type === "change") orientationListeners.delete(listener); },
    addListener(listener) { orientationListeners.add(listener); },
    removeListener(listener) { orientationListeners.delete(listener); },
  };
  const appWindow = {
    matchMedia: () => orientationMedia,
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
  };
  return {
    document,
    elements,
    model,
    orientationMedia,
    changeOrientation(nextPortrait, bounds) {
      orientationMedia.matches = nextPortrait;
      elements.get("viewer-scroller").bounds = bounds;
      for (const listener of orientationListeners) listener({ matches: nextPortrait });
    },
    view: createMobileLayoutViewerView(document, model, null, { window: appWindow }),
  };
}

test("generated mobile definitions match every canonical bundled layout", async () => {
  assert.deepEqual(MOBILE_BUNDLED_LAYOUT_ORDER, Object.keys(BUILTIN_LAYOUTS));
  for (const [key, metadata] of Object.entries(BUILTIN_LAYOUTS)) {
    const canonical = JSON.parse(await readFile(path.join(projectRoot, "src", metadata.file), "utf8"));
    assert.deepEqual(MOBILE_BUNDLED_LAYOUT_DEFINITIONS[key], canonical, key);
  }
});

test("mobile layout semantics are generated exactly from the canonical desktop module", async () => {
  const [canonical, generated] = await Promise.all([
    readFile(path.join(projectRoot, "src/layout_semantics.js"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_semantics.generated.js"), "utf8"),
  ]);
  assert.equal(generated, canonical);
});

test("cold viewer state is immutable, deterministic, and process local", () => {
  const first = new MobileLayoutViewerModel();
  const second = new MobileLayoutViewerModel();
  assert.equal(first.snapshot().catalogStatus, ViewerCatalogStatus.READY);
  assert.equal(first.snapshot().selectedLayoutKey, "qwerty");
  assert.equal(first.snapshot().selectedLayerIndex, 0);
  assert.deepEqual(second.snapshot(), first.snapshot());
  assert.ok(Object.isFrozen(first.snapshot()));
  assert.ok(Object.isFrozen(first.snapshot().presentation.keys));
});

test("layout and layer actions validate selection and reset layers deterministically", () => {
  const model = new MobileLayoutViewerModel();
  model.selectLayout("corne");
  model.selectLayer(2);
  assert.equal(model.snapshot().selectedLayerIndex, 2);
  const unchanged = model.selectLayer(2);
  assert.equal(unchanged, model.snapshot());
  model.selectLayout("dactyl");
  assert.equal(model.snapshot().selectedLayerIndex, 0);
  assert.throws(() => model.selectLayout("external"), LayoutViewerError);
  assert.throws(() => model.selectLayer(999), LayoutViewerError);
});

test("catalog isolates invalid definitions, bounds diagnostics, and exposes an empty state", () => {
  const valid = MOBILE_BUNDLED_LAYOUT_DEFINITIONS.corne;
  const catalog = createMobileLayoutCatalog({
    definitions: { valid, broken: { name: "x" } },
    order: ["broken", "valid"],
    defaultLayoutKey: "broken",
  });
  assert.equal(catalog.status, ViewerCatalogStatus.READY);
  assert.equal(catalog.selectedLayoutKey, "valid");
  assert.deepEqual(catalog.layouts.map(({ key }) => key), ["valid"]);
  assert.ok(catalog.diagnostics[0].length <= VIEWER_DIAGNOSTIC_LIMIT);

  const empty = createMobileLayoutCatalog({ definitions: {}, order: ["missing"] });
  assert.equal(empty.status, ViewerCatalogStatus.EMPTY);
  assert.equal(empty.selectedLayoutKey, null);
});

test("every bundled layer matches shared effective-entry and ordering semantics", () => {
  let sawSpan = false;
  let sawTransparentFallback = false;
  for (const key of MOBILE_BUNDLED_LAYOUT_ORDER) {
    const definition = MOBILE_BUNDLED_LAYOUT_DEFINITIONS[key];
    const shared = normalizeLayerData(definition.keyLayers);
    for (let layerIndex = 0; layerIndex < shared.layers.length; layerIndex += 1) {
      const presentation = createLayoutPresentation(definition, layerIndex);
      assert.deepEqual(presentation.layers.map(({ name }) => name), shared.names, key);
      assert.equal(presentation.keys.length, definition.keyPositions.length, key);
      presentation.keys.forEach((rendered, positionIndex) => {
        const expected = normalizeKeyEntry(effectiveLayerEntry(shared.layers, layerIndex, positionIndex));
        const expectedText = typeof expected.label === "object" ? expected.label.text : expected.label;
        assert.equal(rendered.label, expectedText == null ? "" : String(expectedText));
        sawSpan ||= rendered.widthUnits !== 1 || rendered.heightUnits !== 1;
        sawTransparentFallback ||= layerIndex > 0 && shared.layers[layerIndex]?.[positionIndex] == null && rendered.label !== "";
      });
    }
  }
  assert.equal(sawSpan, true);
  assert.equal(sawTransparentFallback, true);
});

test("view preserves the layer selector element while legends update atomically", () => {
  const harness = viewHarness();
  assert.equal(harness.elements.get("viewer-layout").children.length, MOBILE_BUNDLED_LAYOUT_ORDER.length);
  const initialKeys = harness.elements.get("viewer-keyboard").children.length;
  assert.ok(initialKeys > 0);

  harness.model.selectLayout("corne");
  const selector = harness.elements.get("viewer-layer");
  const retainedOption = selector.children[2];
  selector.value = "2";
  selector.dispatch("change");
  assert.equal(harness.model.snapshot().selectedLayerIndex, 2);
  assert.equal(selector.children[2], retainedOption);
  assert.equal(selector.value, "2");
  assert.equal(retainedOption.textContent, harness.model.snapshot().presentation.layerName);
  assert.deepEqual(selector.children.map(({ value }) => value), harness.model.snapshot().presentation.layers.map(({ index }) => String(index)));
});

test("view redraws every layer when a custom catalog replaces the bundled catalog", () => {
  const harness = viewHarness();
  const customDefinition = {
    name: "Imported board",
    keySize: { w: 44, h: 44, gap: 3 },
    keyPositions: [{ row: 0, col: 0 }],
    keyLayers: {
      default: [["A", "KeyA"]],
      function: [["1", "Num1"]],
      navigation: [["←", "LeftArrow"]],
    },
  };
  const catalog = createMobileLayoutCatalog({
    customRecords: [{ id: "11111111-1111-4111-8111-111111111111", definition: customDefinition }],
  });

  harness.model.replaceCatalog(catalog, "custom:11111111-1111-4111-8111-111111111111");

  const layers = harness.elements.get("viewer-layer");
  assert.equal(harness.elements.get("viewer-layer-field").hidden, false);
  assert.deepEqual(layers.children.map(({ textContent }) => textContent), ["Default", "Function", "Navigation"]);
  layers.value = "1";
  layers.dispatch("change");
  assert.equal(harness.model.snapshot().selectedLayerIndex, 1);
  assert.equal(layers.children.length, 3);
  assert.equal(layers.value, "1");
});

test("view reports empty catalogs without throwing or rendering geometry", () => {
  const harness = viewHarness(new MobileLayoutViewerModel({ definitions: {}, order: ["missing"] }));
  assert.equal(harness.elements.get("viewer-layout").disabled, true);
  assert.equal(harness.elements.get("viewer-empty").hidden, false);
  assert.equal(harness.elements.get("viewer-scroller").hidden, true);
  assert.equal(harness.elements.get("viewer-keyboard").children.length, 0);
});

test("view fits the complete keyboard, rotates only the portrait canvas, and restores landscape", () => {
  const landscape = viewHarness();
  const portrait = viewHarness(new MobileLayoutViewerModel(), { portrait: true });
  const landscapeCanvas = landscape.elements.get("viewer-canvas");
  const portraitCanvas = portrait.elements.get("viewer-canvas");

  assert.equal(landscapeCanvas.dataset.orientation, "landscape");
  assert.equal(portraitCanvas.dataset.orientation, "portrait");
  assert.match(landscapeCanvas.style.width, /px$/);
  assert.match(landscapeCanvas.style.height, /px$/);
  assert.match(portraitCanvas.style.width, /px$/);
  assert.match(portraitCanvas.style.height, /px$/);
  // Counterclockwise rotation lifts the canvas above its box; the shift is the rotated (displayed) height.
  assert.equal(
    portrait.elements.get("viewer-keyboard").style.values.get("--viewer-canvas-translate-y"),
    portraitCanvas.style.height,
  );
  assert.equal(portrait.elements.get("viewer-keyboard").style.values.has("--viewer-canvas-translate-x"), false);
  assert.equal(landscape.elements.get("viewer-layout").value, "qwerty");
  assert.equal(portrait.elements.get("viewer-layout").value, "qwerty");
});

test("orientation refits keep selected layers and inline image legends intact", () => {
  const definition = {
    name: "Inline board",
    keySize: { w: 40, h: 40, gap: 4 },
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    keyLayers: {
      base: [{ text: "Logo", image: "blob:inline-logo", alt: "Logo" }, ["A", "KeyA"]],
      symbols: [["1", "Digit1"], ["!", "Digit1"]],
    },
  };
  const model = new MobileLayoutViewerModel({
    definitions: {},
    order: [],
    customRecords: [{ id: "11111111-1111-4111-8111-111111111111", definition }],
  });
  const subject = viewHarness(model);
  subject.model.selectLayer(1);
  subject.changeOrientation(true, { width: 320, height: 600 });
  assert.equal(subject.elements.get("viewer-canvas").dataset.orientation, "portrait");
  assert.equal(subject.model.snapshot().selectedLayerIndex, 1);
  subject.model.selectLayer(0);
  assert.equal(subject.elements.get("viewer-keyboard").children[0].children[0].src, "blob:inline-logo");
  subject.changeOrientation(false, { width: 700, height: 300 });
  assert.equal(subject.elements.get("viewer-canvas").dataset.orientation, "landscape");
  assert.equal(subject.model.snapshot().selectedLayoutKey, "custom:11111111-1111-4111-8111-111111111111");
});

test("pinch inspection zooms and pans the canvas, then orientation restores its fitted baseline", () => {
  const subject = viewHarness();
  const stage = subject.elements.get("viewer-scroller");
  const gesture = subject.elements.get("viewer-gesture");
  stage.dispatch("pointerdown", { pointerId: 1, clientX: 120, clientY: 120 });
  stage.dispatch("pointerdown", { pointerId: 2, clientX: 220, clientY: 120 });
  stage.dispatch("pointermove", { pointerId: 2, clientX: 320, clientY: 120 });
  assert.equal(gesture.style.values.get("--viewer-gesture-zoom"), "2");
  stage.dispatch("pointerup", { pointerId: 2 });
  stage.dispatch("pointermove", { pointerId: 1, clientX: 180, clientY: 150 });
  assert.notEqual(gesture.style.values.get("--viewer-gesture-pan-x"), "0px");
  stage.dispatch("pointercancel", { pointerId: 1 });
  subject.changeOrientation(true, { width: 320, height: 620 });
  assert.equal(gesture.style.values.get("--viewer-gesture-zoom"), "1");
  assert.equal(gesture.style.values.get("--viewer-gesture-pan-x"), "0px");
  assert.equal(gesture.style.values.get("--viewer-gesture-pan-y"), "0px");
});

test("viewer markup, styles, and modules enforce responsive accessible isolation", async () => {
  const [html, css, modelSource, viewSource] = await Promise.all([
    readFile(path.join(projectRoot, "src-mobile/index.html"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/styles.css"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_viewer_model.js"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_viewer.js"), "utf8"),
  ]);
  assert.match(html, /data-viewer="mobile-layout-viewer"/);
  assert.match(html, /<select id="viewer-layer" aria-label="Keyboard layer">/);
  assert.match(html, /<label class="viewer-field-label" for="viewer-layer">Layer<\/label>/);
  assert.match(html, /id="viewer-live-layer"[^>]*role="status"/);
  assert.match(html, /<input id="viewer-live-switch" type="checkbox" role="switch"/);
  assert.match(html, /<span class="viewer-live-label">Live<\/span>/);
  assert.doesNotMatch(html, /id="viewer-layers"|id="viewer-mode-browse"|id="viewer-mode-live"|aria-label="Keyboard layers"/);
  assert.doesNotMatch(css, /\.viewer-layer\b|\.viewer-layers|\.viewer-mode-controls|\.viewer-control-bar/);
  assert.match(html, /aria-label="Fitted physical keyboard layout"/);
  assert.doesNotMatch(html, /id="viewer-current-layer"|id="viewer-summary"|keyboard-stage-heading/);
  assert.match(html, /id="viewer-canvas" class="viewer-canvas" data-orientation="landscape"/);
  assert.match(html, /id="viewer-gesture" class="viewer-gesture"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /id="viewer-import-layout"[\s\S]*>Import layout</);
  assert.match(html, /id="viewer-remove-controls"[\s\S]*hidden/);
  assert.match(html, /label for="viewer-remove-target">Custom layout to remove</);
  assert.match(html, /id="viewer-remove-layout"[\s\S]*>Remove custom layout</);
  assert.match(html, /id="viewer-layout-status"[\s\S]*aria-live="polite"/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /\.viewer-scroller[\s\S]*overflow:\s*hidden/);
  assert.doesNotMatch(css, /\.keyboard-stage\s*\{[^}]*border:/);
  assert.doesNotMatch(css, /\.keyboard-stage\s*\{[^}]*padding:/);
  assert.match(css, /\.viewer-scroller[\s\S]*padding:\s*6px/);
  assert.match(css, /\.viewer-canvas\[data-orientation="portrait"\][^{]*\{[^}]*translateY\(var\(--viewer-canvas-translate-y[^}]*rotate\(-90deg\)/);
  assert.doesNotMatch(css, /rotate\(90deg\)/, "portrait is counterclockwise so a clockwise turn keeps the canvas fixed to the device");
  assert.doesNotMatch(css, /\.viewer-canvas\[data-orientation="landscape"\][^{]*\{[^}]*rotate/, "landscape stays unrotated");
  assert.match(css, /\.viewer-gesture[\s\S]*--viewer-gesture-zoom/);
  assert.match(css, /\.viewer-key-legend\s*\{\s*font-size:\s*1\.4em/);
  assert.match(css, /env\(safe-area-inset-top, 0px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.doesNotMatch(`${modelSource}\n${viewSource}`, /localStorage|sessionStorage|indexedDB|WebSocket|EventSource|fetch\(|XMLHttpRequest|invoke\(|startScan|requestPermission|connectSelected|subscribeNotifications|write\(/);
  assert.doesNotMatch(modelSource, /function (normalizeViewerLayers|normalizeViewerEntry|effectiveViewerEntry|validateViewerDefinition)/);
});

test("compact and disabled legends keep independent accessible names", () => {
  const definition = {
    name: "Legends",
    keySize: { w: 40, h: 40, gap: 0 },
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
    keyLayers: {
      base: [{ text: "⌫", alt: "Backspace", code: "Backspace" }, ["A", "KeyA"], ["B", "KeyB"]],
      lower: [null, { text: "", alt: "Disabled", code: "" }, null],
    },
  };
  const base = createLayoutPresentation(definition, 0);
  assert.equal(base.keys[0].label, "⌫");
  assert.equal(base.keys[0].accessibleLabel, "Backspace");
  assert.equal(base.keys[1].label, "A");
  assert.equal(base.keys[1].accessibleLabel, "A");

  const lower = createLayoutPresentation(definition, 1);
  assert.equal(lower.keys[0].label, "⌫");
  assert.equal(lower.keys[1].label, "");
  assert.equal(lower.keys[1].accessibleLabel, "Disabled");
  assert.equal(lower.keys[2].label, "B");
});

test("visible text legends use their dedicated presentation class while image legends remain images", () => {
  const subject = viewHarness();
  const textKey = subject.elements.get("viewer-keyboard").children[0];
  assert.equal(textKey.children[0].className, "viewer-key-legend");
  const imageDefinition = {
    name: "Image board", keySize: { w: 40, h: 40, gap: 0 }, keyPositions: [{ row: 0, col: 0 }],
    keyLayers: { base: [{ text: "Logo", image: "blob:inline-logo", alt: "Logo" }] },
  };
  const imageSubject = viewHarness(new MobileLayoutViewerModel({
    definitions: {}, order: [], customRecords: [{ id: "22222222-2222-4222-8222-222222222222", definition: imageDefinition }],
  }));
  assert.equal(imageSubject.elements.get("viewer-keyboard").children[0].children[0].className, "viewer-key-image");
});
