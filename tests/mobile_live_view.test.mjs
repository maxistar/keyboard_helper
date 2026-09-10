import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LayoutPresentationMode,
  MobileLayoutPresentationController,
} from "../src-mobile/layout_live_presentation.js";
import { createMobileLayoutViewerView } from "../src-mobile/layout_viewer.js";
import { MobileLayoutViewerModel } from "../src-mobile/layout_viewer_model.js";
import { createTelemetrySnapshot, TelemetryStatus } from "../src-mobile/telemetry_session.js";

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
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ target: this }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

class TelemetryModel {
  constructor() { this.state = createTelemetrySnapshot(); this.listeners = new Set(); }
  snapshot() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  publish(snapshot) { this.state = snapshot; for (const listener of this.listeners) listener(snapshot); }
}

function live(overrides = {}) {
  return createTelemetrySnapshot(1, TelemetryStatus.LIVE, {
    activeLayer: 1,
    layerAuthoritative: true,
    pressedPositions: [],
    activeCombos: [],
    ...overrides,
  });
}

function harness() {
  const ids = [
    "viewer-layout", "viewer-layers", "viewer-summary", "viewer-diagnostic",
    "viewer-scroller", "viewer-keyboard", "viewer-empty", "viewer-mode-browse",
    "viewer-mode-live", "viewer-stream-status", "viewer-current-layer", "viewer-combo-status",
    "viewer-telemetry-guidance",
  ];
  const elements = new Map(ids.map((id) => [id, new ElementStub(id.includes("mode-") ? "button" : "div")]));
  const document = {
    activeElement: null,
    createElement: (tagName) => new ElementStub(tagName),
    getElementById: (id) => elements.get(id) ?? null,
  };
  const browse = new MobileLayoutViewerModel();
  browse.selectLayout("corne");
  const telemetry = new TelemetryModel();
  const presentation = new MobileLayoutPresentationController(browse, telemetry);
  const view = createMobileLayoutViewerView(document, browse, presentation);
  return { browse, document, elements, presentation, telemetry, view };
}

test("Browse and Live controls expose stream state and preserve manual navigation", () => {
  const subject = harness();
  const browseButton = subject.elements.get("viewer-mode-browse");
  const liveButton = subject.elements.get("viewer-mode-live");
  assert.equal(browseButton.attributes.get("aria-pressed"), "true");
  assert.equal(liveButton.disabled, true);

  subject.telemetry.publish(live());
  assert.equal(liveButton.disabled, false);
  assert.equal(liveButton.attributes.get("aria-pressed"), "true");
  assert.match(subject.elements.get("viewer-stream-status").textContent, /Live telemetry active/);
  assert.match(subject.elements.get("viewer-current-layer").textContent, /Firmware layer/);

  browseButton.dispatch("click");
  assert.equal(subject.presentation.snapshot().mode, LayoutPresentationMode.BROWSE);
  subject.browse.selectLayer(3);
  subject.telemetry.publish(live({ activeLayer: 2, pressedPositions: [7] }));
  assert.equal(subject.presentation.snapshot().mode, LayoutPresentationMode.BROWSE);
  liveButton.dispatch("click");
  assert.equal(subject.presentation.snapshot().selectedLayerIndex, 2);
  assert.deepEqual(subject.presentation.snapshot().pressedPositions, [7]);
});

test("high-rate key and combo updates retain DOM identity, focus, geometry, and bounded children", () => {
  const subject = harness();
  subject.telemetry.publish(live());
  const keyboard = subject.elements.get("viewer-keyboard");
  const retainedKeys = [...keyboard.children];
  const retainedFocus = subject.elements.get("viewer-mode-live");
  subject.document.activeElement = retainedFocus;

  for (let sequence = 0; sequence < 120; sequence += 1) {
    subject.telemetry.publish(live({
      pressedPositions: [sequence % 42],
      activeCombos: sequence % 2 ? [{ comboId: 1, positions: [1, 2], layer: 1 }] : [],
    }));
  }
  assert.equal(keyboard.children.length, 42);
  keyboard.children.forEach((key, index) => assert.equal(key, retainedKeys[index]));
  assert.equal(subject.document.activeElement, retainedFocus);
  assert.equal(keyboard.children[35].dataset.pressed, "true");
  assert.equal(keyboard.children[35].children.at(-1).textContent, "DOWN");
  assert.match(keyboard.children[35].attributes.get("aria-label"), /pressed/);
  assert.equal(subject.elements.get("viewer-combo-status").hidden, false);
});

test("authoritative layer changes update labels without replacing physical key nodes", () => {
  const subject = harness();
  subject.telemetry.publish(live({ activeLayer: 1 }));
  const key = subject.elements.get("viewer-keyboard").children[1];
  const firstLabel = key.children[0].textContent;
  subject.telemetry.publish(live({ activeLayer: 2 }));
  assert.equal(subject.elements.get("viewer-keyboard").children[1], key);
  assert.notEqual(key.children[0].textContent, firstLabel);
});

test("unsupported, failed, gap, and unmatched states use bounded actionable product copy", () => {
  const subject = harness();
  subject.telemetry.publish(createTelemetrySnapshot(1, TelemetryStatus.UNAVAILABLE, {
    reason: { code: "unsupported-protocol-major" },
  }));
  assert.match(subject.elements.get("viewer-stream-status").textContent, /Unsupported telemetry version/);
  assert.match(subject.elements.get("viewer-telemetry-guidance").textContent, /Update/);

  subject.telemetry.publish(createTelemetrySnapshot(1, TelemetryStatus.FAILED, {
    reason: { code: "subscription-failed" },
  }));
  assert.match(subject.elements.get("viewer-telemetry-guidance").textContent, /pairing.*disconnect.*reconnect/i);

  subject.telemetry.publish(live({
    activeLayer: 99,
    pressedPositions: [99],
    diagnostics: [{ code: "sequence-gap", expected: 10, actual: 12, distance: 2 }],
  }));
  const copy = subject.elements.get("viewer-diagnostic").textContent;
  assert.match(copy, /Layer 99/);
  assert.match(copy, /Position 99/);
  assert.match(copy, /events were missed/);
  assert.doesNotMatch(copy, /expected|actual|sequence|10|12/iu);
  assert.ok(copy.length < 400);
});

test("Live UI source preserves accessibility, responsive containment, privacy, and platform isolation", async () => {
  const [html, css, view, presentation, telemetry, app] = await Promise.all([
    readFile(path.join(projectRoot, "src-mobile/index.html"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/styles.css"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_viewer.js"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_live_presentation.js"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/telemetry_session.js"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/app.js"), "utf8"),
  ]);
  assert.match(html, /aria-label="Layout presentation mode"/);
  assert.match(html, /viewer-stream-status[\s\S]*aria-live="polite"/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /safe-area-inset/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /viewer-key-state/);
  assert.match(css, /outline:\s*3px dashed/);
  const source = `${view}\n${presentation}\n${telemetry}\n${app}`;
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|WebSocket|EventSource|fetch\(|XMLHttpRequest|setInterval|foreground service/iu);
  assert.doesNotMatch(source, /main\.js|menu\.js|overlay|global.listener|input.source|ble_layer_sync|writeLayer/iu);
  assert.doesNotMatch(html, /raw frame|sequence log|typing history/iu);
});
