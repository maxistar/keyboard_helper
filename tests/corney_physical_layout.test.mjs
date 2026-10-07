import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { buildLayout, loadLayoutDefinition, normalizeLayerData } from "../src/layout_catalog.js";
import { calcCanvasGeometry } from "../src/layout_geometry.js";
import {
  CustomLayoutController,
} from "../src-mobile/custom_layouts.js";
import {
  createLayoutPresentation,
  createMobileLayoutCatalog,
  MobileLayoutViewerModel,
} from "../src-mobile/layout_viewer_model.js";

const corneyUrl = new URL("../../corney/layout_corney.json", import.meta.url);
const corney = JSON.parse(await readFile(corneyUrl, "utf8"));

const mainRows = [
  [0.3, 0.3, 0.1, 0, 0.1, 0.2, 0.2, 0.1, 0, 0.1, 0.3, 0.3],
  [1.3, 1.3, 1.1, 1, 1.1, 1.2, 1.2, 1.1, 1, 1.1, 1.3, 1.3],
  [2.3, 2.3, 2.1, 2, 2.1, 2.2, 2.2, 2.1, 2, 2.1, 2.3, 2.3],
];
const mainCols = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14];
const comboSemantics = [
  { id: 1, positions: [1, 2], code: "Escape" },
  { id: 2, positions: [15, 16], code: "Return" },
  { id: 3, positions: [19, 20], code: "Return" },
  { id: 4, positions: [27, 28], code: "Backspace" },
  { id: 5, positions: [31, 32], code: "Backspace" },
  { id: 6, positions: [40, 41], code: "" },
  { id: 7, positions: [36, 37], code: "" },
];

test("Corney preserves matrix order while adopting stock main-block stagger", () => {
  assert.equal(corney.keyPositions.length, 42);
  assert.deepEqual(corney.keyPositions.slice(0, 36).map(({ row, col }) => [row, col]), [
    ...mainRows.flatMap((rows) => rows.map((row, index) => [row, mainCols[index]])),
  ]);
  assert.deepEqual(corney.keyPositions.slice(36), [
    { row: 3.2, col: 4, cls: "action" },
    { row: 3.2, col: 5, cls: "action", angle: 5 },
    { row: 2.9, col: 6, cls: "action", angle: 10, h: 1.5 },
    { row: 2.9, col: 8, cls: "action", angle: -10, h: 1.5 },
    { row: 3.2, col: 9, cls: "action", angle: -5 },
    { row: 3.2, col: 10, cls: "action" },
  ]);
  const bottom = (position) => position.row * (corney.keySize.h + corney.keySize.gap)
    + corney.keySize.h * (position.h ?? 1)
    + corney.keySize.gap * ((position.h ?? 1) - 1);
  assert.equal(bottom(corney.keyPositions[38]) - bottom(corney.keyPositions[36]), 11);
  assert.equal(bottom(corney.keyPositions[39]) - bottom(corney.keyPositions[41]), 11);
});

test("Corney combo identities stay stable and coordinate aliases follow their positions", () => {
  assert.deepEqual(corney.combos.map(({ id, positions, code }) => ({ id, positions, code })), comboSemantics);
  for (const combo of corney.combos) {
    const first = corney.keyPositions[combo.positions[0]];
    const second = corney.keyPositions[combo.positions[1]];
    assert.deepEqual(combo.key1, { row: first.row, col: first.col }, `combo ${combo.id} key1`);
    assert.deepEqual(combo.key2, { row: second.row, col: second.col }, `combo ${combo.id} key2`);
  }
});

test("Corney non-geometry contract remains present", () => {
  assert.equal(corney.format, "keyboard-helper-layout");
  assert.equal(corney.version, 1);
  assert.equal(corney.name, "Corney (split)");
  assert.deepEqual(corney.keySize, { w: 57, h: 45, gap: 10 });
  assert.deepEqual(Object.keys(corney.keyLayers), [
    "Default", "Linux: Default", "Linux: Shift", "Linux: AltGr",
    "Mac: Default", "Mac: Shift", "Mac: AltGr", "Android: Default",
    "Linux Russian", "Mac: Russian", "Mac: Russian-Shift", "Default: Russian-AltGr",
    "Mac: Russian-AltGr", "All: Functional", "All: Characters / Navigation",
    "All: De-Characters / Navigation", "Mac: Characters / Navigation",
    "Mac: Characters-rus / Navigation", "All: Numbers / Mouse",
  ]);
  assert.deepEqual(corney.combos.map(({ id, positions, code }) => ({ id, positions, code })), comboSemantics);
  assert.ok(corney.bleLayerSource);
  assert.ok(corney.inputSourceSync);
});

test("rotated 1.5u height retains the complete shared canvas bounds", () => {
  const geometry = calcCanvasGeometry(
    [{ row: 0, col: 0, h: 1.5, angle: 90 }],
    { w: 57, h: 45, gap: 10 },
  );
  assert.ok(Math.abs(geometry.originX - (-7.75)) < 1e-9);
  assert.ok(Math.abs(geometry.originY - 7.75) < 1e-9);
  assert.ok(Math.abs(geometry.width - 72.5) < 1e-9);
  assert.ok(Math.abs(geometry.height - 57) < 1e-9);
});

class MemoryAdapter {
  constructor(content) {
    this.available = true;
    this.content = content;
    this.records = [];
    this.selection = null;
  }
  async pickLayout() { return { cancelled: false, content: this.content }; }
  async listRecords() { return { records: this.records, diagnostics: [] }; }
  async readSelection() { return { selection: this.selection, diagnostic: null }; }
  async writeRecord(value) { this.records = [{ ...value }]; }
  async writeSelection(value) { this.selection = { ...value }; }
  async removeRecord(id) { this.records = this.records.filter((record) => record.id !== id); }
}

test("desktop external and mobile custom Corney presentations preserve geometry", async () => {
  const urlApi = {
    createObjectURL: () => "blob:corney-test",
    revokeObjectURL: () => {},
  };
  const external = await loadLayoutDefinition("corney", "/layout_corney.json", {
    readExternal: async () => JSON.stringify(corney),
    urlApi,
  });
  assert.equal(external.error, null);
  assert.ok(external.definition);

  const layers = normalizeLayerData(external.definition.keyLayers);
  const desktop = buildLayout(external.definition, layers.layers);
  const desktopGeometry = calcCanvasGeometry(external.definition.keyPositions, external.definition.keySize);

  const viewer = new MobileLayoutViewerModel({ definitions: {}, order: [] });
  const controller = new CustomLayoutController(viewer, new MemoryAdapter(JSON.stringify(corney)), {
    bundledDefinitions: {},
    bundledOrder: [],
    defaultLayoutKey: "",
    crypto: webcrypto,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    urlApi,
    Blob,
  });
  await controller.initialize();
  const imported = await controller.importLayout();
  assert.equal(imported.status, "imported");

  const mobile = viewer.snapshot().presentation;
  assert.ok(mobile);
  assert.deepEqual(mobile.keys.map(({ row, col, widthUnits, heightUnits, angle }) => ({
    row, col, w: widthUnits, h: heightUnits, angle,
  })), desktop.keys.map((key) => ({
    row: key.row,
    col: key.col,
    w: key.w ?? 1,
    h: key.h ?? 1,
    angle: key.angle ?? 0,
  })));
  assert.deepEqual(
    { width: mobile.width, height: mobile.height, origin: mobile.origin },
    { width: desktopGeometry.width, height: desktopGeometry.height, origin: { x: desktopGeometry.originX, y: desktopGeometry.originY } },
  );
  assert.deepEqual(
    viewer.catalog.definitions[`custom:${imported.record.id}`].combos.map(({ id, positions, code }) => ({ id, positions, code })),
    comboSemantics,
  );
});

test("custom catalog presentation accepts the canonical Corney definition without bundling it", () => {
  const catalog = createMobileLayoutCatalog({
    definitions: {},
    order: [],
    defaultLayoutKey: "",
    customRecords: [{ id: "22222222-2222-4222-8222-222222222222", definition: corney }],
  });
  assert.deepEqual(catalog.layouts.map(({ source, custom }) => ({ source, custom })), [{ source: "custom", custom: true }]);
  assert.equal(catalog.layouts[0].name, "Corney (split) (Custom)");
  const presentation = createLayoutPresentation(catalog.definitions["custom:22222222-2222-4222-8222-222222222222"], 0);
  assert.equal(presentation.keys.length, 42);
  assert.equal(presentation.keys[38].heightUnits, 1.5);
  assert.equal(presentation.keys[38].angle, 10);
  assert.equal(presentation.keys[39].heightUnits, 1.5);
  assert.equal(presentation.keys[39].angle, -10);
});
