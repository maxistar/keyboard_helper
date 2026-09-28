import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInsightsController, defaultRange } from "../src/typing_insights/controller.js";
import { EN_WORDS } from "../src/typing_insights/dictionaries/en.js";
import { RU_WORDS } from "../src/typing_insights/dictionaries/ru.js";
import { buildInsights } from "../src/typing_insights/model.js";
import { formatPair, renderHeatmap, renderInsights, renderTrend } from "../src/typing_insights/view.js";

class NodeStub {
  constructor(tag, namespace = null) {
    this.tagName = String(tag).toUpperCase();
    this.namespace = namespace;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this._text = "";
    this.value = "";
    this.selected = false;
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  dispatch(type) { return Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({ target: this }))); }
  all(predicate, found = []) {
    for (const child of this.children) { if (predicate(child)) found.push(child); child.all?.(predicate, found); }
    return found;
  }
}

class TextStub { constructor(text) { this.textContent = text; this.children = []; } all() { return []; } }

const documentStub = {
  createElement: (tag) => new NodeStub(tag),
  createElementNS: (namespace, tag) => new NodeStub(tag, namespace),
  createTextNode: (text) => new TextStub(text),
};

const layout = async (name) => JSON.parse(await readFile(new URL(`../src/layout_${name}.json`, import.meta.url), "utf8"));
const byTag = (root, tag) => root.all((node) => node.tagName === tag.toUpperCase());

function histogramAt(bucket, count) {
  const histogram = Array(13).fill(0);
  histogram[bucket] = count;
  return histogram;
}

function pair(fromCode, toCode, { day = "2026-09-20", bucket = 2, count = 30, corrections = 0, language = "unknown", layout: layoutKey = "qwerty" } = {}) {
  return { day, type: "pair", collectionType: "background", layout: layoutKey, language, fromCode, toCode,
    sampleCount: count, correctionCount: corrections, latencySumMs: 0, histogram: histogramAt(bucket, count) };
}

const session = (day, correctCharacters) => ({ day, type: "session", collectionType: "exercise", layout: "qwerty", language: "unknown",
  fromCode: "", toCode: "", sampleCount: 1, exercise: { sessionCount: 1, correctCharacters, mistakes: 5, activeDurationMs: 60_000 } });

const populatedRows = () => [
  pair("KeyT", "KeyH", { bucket: 7, count: 40, corrections: 4 }),
  pair("KeyA", "KeyS", { bucket: 2, count: 160 }),
  pair("KeyA", "F1", { bucket: 2, count: 35 }),
  session("2026-09-19", 100), session("2026-09-21", 150),
  { day: "2026-09-21", type: "target", collectionType: "exercise", layout: "qwerty", language: "unknown", fromCode: "moon", toCode: "",
    sampleCount: 3, correctionCount: 2, exercise: { completedCount: 1 } },
];

test("empty dashboard explains which setting to enable and links to Settings", () => {
  const container = new NodeStub("div");
  let opened = 0;
  renderInsights(documentStub, container, buildInsights({ rows: [] }), { onOpenSettings: () => { opened += 1; } });
  assert.match(container.textContent, /No typing statistics yet/);
  assert.match(container.textContent, /Collect background timing/);
  assert.match(container.textContent, /Collect focused exercise statistics/);
  const [button] = byTag(container, "button");
  button.dispatch("click");
  assert.equal(opened, 1);
});

test("populated dashboard renders cards, labelled hotspots, suggestions with both readings, and limitations", async () => {
  const definition = await layout("qwerty");
  const insights = buildInsights({ rows: populatedRows(), layoutDefinition: definition, dictionaries: { en: EN_WORDS, ru: RU_WORDS } });
  const container = new NodeStub("div");
  renderInsights(documentStub, container, insights, { layoutDefinition: definition });
  const text = container.textContent;

  assert.match(text, /Exercise WPM/);
  assert.match(text, /Possible-correction rate/);
  assert.match(text, /1\.7%/);
  assert.match(text, /T → H/);
  assert.match(text, /Possible corrections \(background typing\)/);
  assert.match(text, /not confirmed errors/);
  assert.match(text, /Exercise errors/);
  assert.match(text, /moon/);
  assert.match(text, /Practise T → H/);
  assert.match(text, /English: th/);
  assert.match(text, /Russian: ер/);
  assert.match(text, /Practise “moon”/);
  assert.match(text, /Exercise error: 2 exercise errors/);
  assert.match(text, /input language is unknown/);
  assert.doesNotMatch(text, /Unmapped keys/);
});

test("suggestions narrow to one reading when the language is known and explain missing words", () => {
  const insights = buildInsights({
    rows: [pair("KeyG", "KeyH", { bucket: 7, count: 40, language: "xkb:layout:ru" }), pair("KeyA", "KeyS", { bucket: 2, count: 160, language: "xkb:layout:ru" }),
      pair("Space", "KeyQ", { bucket: 7, count: 40, corrections: 3, language: "xkb:layout:ru" })],
    dictionaries: { en: EN_WORDS, ru: RU_WORDS },
  });
  const container = new NodeStub("div");
  renderInsights(documentStub, container, insights, {});
  const readings = container.all((node) => node.getAttribute?.("lang"));
  assert.deepEqual(readings.map((node) => node.getAttribute("lang")), ["ru"]);
  assert.match(container.textContent, /No English or Russian letter reading for this key pair/);
  assert.doesNotMatch(container.textContent, /input language is unknown/);
});

test("heatmap colours measured keys, leaves others grey, and lists unmapped keys", async () => {
  const definition = await layout("corne");
  const insights = buildInsights({ rows: populatedRows(), layoutDefinition: definition });
  const node = renderHeatmap(documentStub, insights.heatmap, definition);
  const rects = byTag(node, "rect");
  assert.equal(rects.length, definition.keyPositions.length);
  const coloured = rects.filter((rect) => rect.getAttribute("data-ratio") !== "");
  assert.deepEqual(coloured.map((rect) => rect.getAttribute("fill")).sort(), ["var(--heat-ok)", "var(--heat-slow)"]);
  assert.equal(rects.filter((rect) => rect.getAttribute("fill") === "var(--heat-none)").length, definition.keyPositions.length - 2);
  assert.match(node.textContent, /F1 — not on the base layer/);
  const rotated = await layout("sofle");
  const sofleNode = renderHeatmap(documentStub, buildInsights({ rows: populatedRows(), layoutDefinition: rotated }).heatmap, rotated);
  assert.ok(byTag(sofleNode, "g").some((group) => /^rotate\(12 /.test(group.getAttribute("transform") ?? "")));
  assert.match(renderHeatmap(documentStub, insights.heatmap, null).textContent, /Select a layout/);
});

test("trend chart plots one point per day with exercise data", () => {
  const node = renderTrend(documentStub, [
    { day: "2026-09-19", sessionCount: 1, wpm: 20, accuracy: 95 },
    { day: "2026-09-20", sessionCount: 0, wpm: null, accuracy: null },
    { day: "2026-09-21", sessionCount: 1, wpm: 30, accuracy: 96 },
  ]);
  const circles = byTag(node, "circle");
  assert.equal(circles.filter((circle) => circle.getAttribute("class") === "trend-wpm").length, 2);
  assert.equal(circles.filter((circle) => circle.getAttribute("class") === "trend-accuracy").length, 2);
  assert.match(node.textContent, /2026-09-19 to 2026-09-21/);
  assert.match(renderTrend(documentStub, [{ day: "2026-09-20", wpm: null }]).textContent, /No exercise sessions/);
  assert.equal(formatPair("KeyT", "Num1"), "T → 1");
});

test("controller loads the default range, rebuilds on filter changes, and reloads on range changes", async () => {
  const qwerty = await layout("qwerty");
  const elements = Object.fromEntries(["from", "to", "layout", "language", "source", "minSamples", "refresh", "status", "content"]
    .map((name) => [name, new NodeStub(name === "content" ? "div" : "select")]));
  elements.minSamples.value = "0";
  const reads = [];
  const controller = createInsightsController({
    document: documentStub,
    elements,
    readRows: async (from, to) => { reads.push([from, to]); return populatedRows(); },
    readSettings: async () => ({ exercise: true, background: true }),
    catalog: { definitions: { qwerty }, defaultLayout: "qwerty" },
    today: new Date(2026, 8, 28, 12),
  });
  assert.deepEqual(defaultRange(new Date(2026, 8, 28, 12)), { from: "2026-08-30", to: "2026-09-28" });
  const initial = await controller.load();
  assert.deepEqual(reads, [["2026-08-30", "2026-09-28"]]);
  assert.equal(initial.slowPairs.length, 1);
  assert.deepEqual(elements.layout.children.map((option) => option.value), ["", "qwerty"]);
  assert.deepEqual(elements.language.children.map((option) => option.textContent), ["All languages", "Unknown language"]);

  elements.minSamples.value = "50";
  const filtered = await elements.minSamples.dispatch("change").then(() => controller.render());
  assert.equal(filtered.slowPairs.length, 0);
  assert.equal(filtered.summary.coverage.hiddenByMinimum, 2);
  assert.equal(reads.length, 1);

  elements.source.value = "background";
  assert.equal(controller.render().exerciseErrors.length, 0);

  elements.from.value = "2026-09-01";
  await elements.from.dispatch("change");
  assert.deepEqual(reads.at(-1), ["2026-09-01", "2026-09-28"]);
  assert.match(elements.status.textContent, /daily aggregates/);
});

test("controller reports read failures without rendering stale data", async () => {
  const elements = Object.fromEntries(["from", "to", "layout", "language", "source", "minSamples", "refresh", "status", "content"]
    .map((name) => [name, new NodeStub("div")]));
  const controller = createInsightsController({ document: documentStub, elements, readRows: async () => { throw new Error("database locked"); } });
  assert.equal(await controller.load(), null);
  assert.match(elements.status.textContent, /Could not read local statistics: database locked/);
  assert.equal(elements.content.children.length, 0);
});

test("dashboard data and rendering never carry typed text, application, key-history, layer, combo, or device values", async () => {
  const secrets = ["hunter2 password", "Slack.app", "KeyH,KeyE,KeyL,KeyL,KeyO", "layer-7", "combo-42", "device-AA:BB"];
  const rows = populatedRows().map((row) => ({
    ...row, text: secrets[0], applicationName: secrets[1], keyHistory: secrets[2], layer: secrets[3], comboId: secrets[4], deviceId: secrets[5],
  }));
  const definition = await layout("qwerty");
  const insights = buildInsights({ rows, layoutDefinition: definition, dictionaries: { en: EN_WORDS, ru: RU_WORDS } });
  const container = new NodeStub("div");
  renderInsights(documentStub, container, insights, { layoutDefinition: definition });
  const serialized = JSON.stringify(insights);
  const rendered = container.textContent + JSON.stringify(container.all(() => true).map((node) => [...(node.attributes?.entries?.() ?? [])]));
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `insights leak ${secret}`);
    assert.equal(rendered.includes(secret), false, `rendering leaks ${secret}`);
  }
  for (const field of ["text", "applicationName", "keyHistory", "layer", "comboId", "deviceId"]) {
    assert.equal(serialized.includes(`"${field}"`), false, `insights expose ${field}`);
  }
});
