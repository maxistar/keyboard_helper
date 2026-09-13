import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { buildLayout, normalizeLayerData } from "../src/layout_catalog.js";
import { resolveInlineLayoutAssets } from "../src/inline_asset_presentation.js";
import { CustomLayoutController } from "../src-mobile/custom_layouts.js";
import { MobileLayoutViewerModel } from "../src-mobile/layout_viewer_model.js";
import { inlineImageLayout } from "./fixtures/inline_layout_assets.mjs";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";

class MemoryAdapter {
  constructor(content) {
    this.available = true;
    this.records = [];
    this.selection = null;
    this.picker = { cancelled: false, content };
  }
  async pickLayout() { return this.picker; }
  async listRecords() { return { records: this.records, diagnostics: [] }; }
  async readSelection() { return { selection: this.selection, diagnostic: null }; }
  async writeRecord(value) { this.records = [{ ...value }]; }
  async removeRecord(id) { this.records = this.records.filter((record) => record.id !== id); }
  async writeSelection(value) { this.selection = { ...value }; }
}

test("shared inline fixture has matching desktop and mobile image presentation", async () => {
  const fixture = inlineImageLayout({ overrides: {
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1, w: 2 }],
    keyLayers: { default: [["Logo", "", "asset:logo"], ["B", "KeyB"]], fn: [["FnLogo", "", "asset:logo"], null] },
  } });
  const desktopUrls = [];
  const urlApi = { createObjectURL: () => `blob:shared-${desktopUrls.push(true)}`, revokeObjectURL: () => {} };
  const desktopResolved = resolveInlineLayoutAssets(fixture, { urlApi }).definition;
  const desktopLayers = normalizeLayerData(desktopResolved.keyLayers);
  const desktopLayout = buildLayout(desktopResolved, desktopLayers.layers);

  const adapter = new MemoryAdapter(JSON.stringify(fixture));
  const mobileUrls = [];
  const mobile = new MobileLayoutViewerModel();
  const controller = new CustomLayoutController(mobile, adapter, {
    crypto: webcrypto,
    randomUUID: () => FIRST_ID,
    urlApi: { createObjectURL: () => `blob:shared-${mobileUrls.push(true)}`, revokeObjectURL: () => {} },
    Blob,
  });
  await controller.initialize();
  await controller.importLayout();
  const snapshot = mobile.snapshot();

  assert.equal(desktopResolved.keyLayers.default[0][2], "blob:shared-1");
  assert.equal(snapshot.presentation.keys[0].image, "blob:shared-1");
  assert.equal(snapshot.presentation.keys[0].accessibleLabel, "Logo");
  assert.deepEqual(snapshot.presentation.layers.map(({ name }) => name), desktopLayers.names);
  assert.equal(snapshot.presentation.keySize.w, desktopLayout.keySize.w);
  assert.equal(snapshot.presentation.keys[1].widthUnits, desktopLayout.keys[1].w);
  assert.equal(snapshot.presentation.width, 3 * (fixture.keySize.w + fixture.keySize.gap) + fixture.keySize.w);
  assert.equal(desktopUrls.length, 1);
  assert.equal(mobileUrls.length, 1);
});
