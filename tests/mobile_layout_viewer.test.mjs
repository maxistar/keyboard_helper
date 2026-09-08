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
    this.hidden = false;
    this.listeners = new Map();
    this.style = new StyleStub();
    this.textContent = "";
    this.value = "";
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ target: this }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

function viewHarness(model = new MobileLayoutViewerModel()) {
  const ids = [
    "viewer-layout", "viewer-layers", "viewer-summary", "viewer-diagnostic",
    "viewer-scroller", "viewer-keyboard", "viewer-empty",
  ];
  const elements = new Map(ids.map((id) => [id, new ElementStub(id === "viewer-layout" ? "select" : "div")]));
  const document = {
    createElement: (tagName) => new ElementStub(tagName),
    getElementById: (id) => elements.get(id) ?? null,
  };
  return { document, elements, model, view: createMobileLayoutViewerView(document, model) };
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
  model.selectLayer(3);
  assert.equal(model.snapshot().selectedLayerIndex, 3);
  const unchanged = model.selectLayer(3);
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
  let sawImage = false;
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
        sawImage ||= Boolean(rendered.image);
        sawTransparentFallback ||= layerIndex > 0 && shared.layers[layerIndex]?.[positionIndex] == null && rendered.label !== "";
      });
    }
  }
  assert.equal(sawSpan, true);
  assert.equal(sawImage, true);
  assert.equal(sawTransparentFallback, true);
});

test("view preserves layer control focus objects while legends update atomically", () => {
  const harness = viewHarness();
  assert.equal(harness.elements.get("viewer-layout").children.length, MOBILE_BUNDLED_LAYOUT_ORDER.length);
  const initialKeys = harness.elements.get("viewer-keyboard").children.length;
  assert.ok(initialKeys > 0);

  harness.model.selectLayout("corne");
  const layers = harness.elements.get("viewer-layers").children;
  const retainedButton = layers[2];
  retainedButton.dispatch("click");
  assert.equal(harness.model.snapshot().selectedLayerIndex, 2);
  assert.equal(harness.elements.get("viewer-layers").children[2], retainedButton);
  assert.equal(retainedButton.attributes.get("aria-pressed"), "true");
  assert.match(
    harness.elements.get("viewer-summary").textContent,
    new RegExp(harness.model.snapshot().presentation.layerName, "i"),
  );
});

test("view reports empty catalogs without throwing or rendering geometry", () => {
  const harness = viewHarness(new MobileLayoutViewerModel({ definitions: {}, order: ["missing"] }));
  assert.equal(harness.elements.get("viewer-layout").disabled, true);
  assert.equal(harness.elements.get("viewer-empty").hidden, false);
  assert.equal(harness.elements.get("viewer-scroller").hidden, true);
  assert.equal(harness.elements.get("viewer-keyboard").children.length, 0);
});

test("viewer markup, styles, and modules enforce responsive accessible isolation", async () => {
  const [html, css, modelSource, viewSource] = await Promise.all([
    readFile(path.join(projectRoot, "src-mobile/index.html"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/styles.css"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_viewer_model.js"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_viewer.js"), "utf8"),
  ]);
  assert.match(html, /data-viewer="mobile-layout-viewer"/);
  assert.match(html, /aria-label="Keyboard layers"/);
  assert.match(html, /aria-label="Scrollable physical keyboard layout"/);
  assert.match(html, /id="viewer-scroller"[\s\S]*tabindex="0"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /safe-area-inset/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.doesNotMatch(`${modelSource}\n${viewSource}`, /localStorage|sessionStorage|indexedDB|WebSocket|EventSource|fetch\(|XMLHttpRequest|invoke\(|startScan|requestPermission|connectSelected|subscribeNotifications|write\(/);
  assert.doesNotMatch(modelSource, /function (normalizeViewerLayers|normalizeViewerEntry|effectiveViewerEntry|validateViewerDefinition)/);
});
