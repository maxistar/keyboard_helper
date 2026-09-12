import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CUSTOM_LAYOUT_RECORD_VERSION,
  CustomLayoutController,
  CustomLayoutError,
  normalizeCustomLayoutName,
  sha256Hex,
  validateImportedLayout,
} from "../src-mobile/custom_layouts.js";
import { MobileLayoutPresentationController } from "../src-mobile/layout_live_presentation.js";
import { MobileLayoutViewerModel } from "../src-mobile/layout_viewer_model.js";
import { NativeLayoutAdapter } from "../src-mobile/native_layout_adapter.js";
import { createTelemetrySnapshot, TelemetryStatus } from "../src-mobile/telemetry_session.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function definition(name = "My Corne", label = "A") {
  return {
    name,
    keySize: { w: 50, h: 50, gap: 4 },
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    combos: [{ id: 7, positions: [0, 1], code: "Escape" }],
    keyLayers: { default: [[label, "KeyA"], ["B", "KeyB"]], fn: [["1", "Num1"], null] },
  };
}

async function record(id = FIRST_ID, value = definition()) {
  const content = JSON.stringify(value);
  return {
    schemaVersion: CUSTOM_LAYOUT_RECORD_VERSION,
    id,
    name: value.name,
    normalizedName: normalizeCustomLayoutName(value.name),
    digest: await sha256Hex(content, webcrypto),
    content,
  };
}

class MemoryAdapter {
  constructor({ records = [], selection = null, diagnostics = [], picker = { cancelled: true } } = {}) {
    this.available = true;
    this.records = records.map((item) => ({ ...item }));
    this.selection = selection;
    this.diagnostics = diagnostics;
    this.picker = picker;
    this.calls = [];
    this.fail = null;
  }
  async pickLayout() { this.calls.push(["pick"]); return this.picker; }
  async listRecords() { this.calls.push(["list"]); return { records: this.records, diagnostics: this.diagnostics }; }
  async readSelection() { this.calls.push(["read-selection"]); return { selection: this.selection, diagnostic: null }; }
  async writeRecord(value) {
    this.calls.push(["write-record", value.id]);
    if (this.fail === "write-record") throw new Error("write failed");
    this.records = [...this.records.filter(({ id }) => id !== value.id), { ...value }];
  }
  async removeRecord(id) {
    this.calls.push(["remove-record", id]);
    if (this.fail === "remove-record") throw new Error("remove failed");
    this.records = this.records.filter((item) => item.id !== id);
  }
  async writeSelection(value) {
    this.calls.push(["write-selection", value.source, value.id]);
    if (this.fail === "write-selection") throw new Error("preference failed");
    this.selection = { ...value };
  }
}

class TelemetryModel {
  constructor(snapshot) { this.state = snapshot; this.listeners = new Set(); }
  snapshot() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
}

test("import validation shares semantic bounds and rejects every image reference form", () => {
  assert.equal(validateImportedLayout("not-json").code, "invalid-json");
  assert.equal(validateImportedLayout(JSON.stringify({ name: "x" })).code, "invalid-layout");
  const oversized = { ...definition(), keyPositions: Array.from({ length: 257 }, (_, col) => ({ row: 0, col })) };
  assert.equal(validateImportedLayout(JSON.stringify(oversized)).code, "invalid-layout");
  for (const image of ["assets/images/key.png", "https://example.test/key.png", "data:image/png;base64,AA==", "../key.png"]) {
    const value = definition();
    value.keyLayers.default[0] = ["A", "KeyA", image];
    assert.equal(validateImportedLayout(JSON.stringify(value)).code, "image-assets-unsupported", image);
  }
  assert.equal(validateImportedLayout(JSON.stringify(definition())).valid, true);
  assert.equal(validateImportedLayout(" ".repeat(524_289)).code, "document-too-large");
});

test("picker cancellation is a no-op and a failed preference commit rolls back a new record", async () => {
  const adapter = new MemoryAdapter();
  const model = new MobileLayoutViewerModel();
  const controller = new CustomLayoutController(model, adapter, { crypto: webcrypto, randomUUID: () => FIRST_ID });
  await controller.initialize();
  assert.equal((await controller.importLayout()).status, "cancelled");
  assert.equal(adapter.records.length, 0);
  adapter.picker = { cancelled: false, content: JSON.stringify(definition()) };
  adapter.fail = "write-selection";
  await assert.rejects(controller.importLayout(), /preference failed/);
  assert.equal(adapter.records.length, 0);
  assert.equal(model.snapshot().selectedLayoutKey, "qwerty");
});

test("startup revalidates records, restores custom selection at layer zero, and bounds recovery", async () => {
  const good = await record();
  const corrupt = { ...await record(SECOND_ID, definition("Broken")), digest: "0".repeat(64) };
  const adapter = new MemoryAdapter({
    records: [good, corrupt],
    selection: { schemaVersion: 1, source: "custom", id: FIRST_ID },
    diagnostics: ["native recovery"],
  });
  const model = new MobileLayoutViewerModel();
  model.selectLayer(1);
  const controller = new CustomLayoutController(model, adapter, { crypto: webcrypto });
  await controller.initialize();
  assert.equal(model.snapshot().selectedLayoutKey, `custom:${FIRST_ID}`);
  assert.equal(model.snapshot().selectedLayerIndex, 0);
  assert.deepEqual(model.snapshot().layouts.slice(-1).map(({ source, name }) => [source, name]), [["custom", "My Corne (Custom)"]]);
  assert.ok(model.snapshot().diagnostics.join(" ").includes("native recovery"));
  assert.equal(controller.records.length, 1);
});

test("missing durable selection repairs to bundled default", async () => {
  const adapter = new MemoryAdapter({ selection: { schemaVersion: 1, source: "custom", id: FIRST_ID } });
  const model = new MobileLayoutViewerModel();
  const controller = new CustomLayoutController(model, adapter, { crypto: webcrypto });
  await controller.initialize();
  assert.equal(model.snapshot().selectedLayoutKey, "qwerty");
  assert.deepEqual(adapter.selection, { schemaVersion: 1, source: "bundled", id: "qwerty" });
});

test("import, exact duplicate, replacement cancellation, and stable replacement are deterministic", async () => {
  const firstContent = JSON.stringify(definition("Corne"));
  const adapter = new MemoryAdapter({ picker: { cancelled: false, content: firstContent } });
  const model = new MobileLayoutViewerModel();
  const controller = new CustomLayoutController(model, adapter, {
    crypto: webcrypto,
    randomUUID: () => FIRST_ID,
  });
  await controller.initialize();
  const imported = await controller.importLayout();
  assert.equal(imported.status, "imported");
  assert.equal(model.snapshot().selectedLayoutKey, `custom:${FIRST_ID}`);

  assert.equal((await controller.importLayout()).status, "duplicate");
  assert.equal(adapter.records.length, 1);

  adapter.picker = { cancelled: false, content: JSON.stringify(definition(" Corne ", "Z")) };
  assert.equal((await controller.importLayout(async () => false)).status, "cancelled-replacement");
  const replaced = await controller.importLayout(async () => true);
  assert.equal(replaced.status, "replaced");
  assert.equal(replaced.record.id, FIRST_ID);
  assert.equal(controller.records[0].definition.keyLayers.default[0][0], "Z");
});

test("selected removal persists bundled fallback and rolls back preference when removal fails", async () => {
  const stored = await record();
  const adapter = new MemoryAdapter({ records: [stored], selection: { schemaVersion: 1, source: "custom", id: FIRST_ID } });
  const model = new MobileLayoutViewerModel();
  const controller = new CustomLayoutController(model, adapter, { crypto: webcrypto });
  await controller.initialize();
  adapter.fail = "remove-record";
  await assert.rejects(controller.removeLayout(`custom:${FIRST_ID}`), /remove failed/);
  assert.deepEqual(adapter.selection, { schemaVersion: 1, source: "custom", id: FIRST_ID });
  assert.equal(model.snapshot().selectedLayoutKey, `custom:${FIRST_ID}`);

  adapter.fail = null;
  await controller.removeLayout(`custom:${FIRST_ID}`);
  assert.equal(model.snapshot().selectedLayoutKey, "qwerty");
  assert.deepEqual(adapter.selection, { schemaVersion: 1, source: "bundled", id: "qwerty" });
  await assert.rejects(controller.removeLayout("qwerty"), (error) => error instanceof CustomLayoutError && error.code === "bundled-protected");
});

test("inactive removal keeps the current custom presentation and durable selection", async () => {
  const selected = await record();
  const inactive = await record(SECOND_ID, definition("Other board", "Z"));
  const adapter = new MemoryAdapter({
    records: [selected, inactive],
    selection: { schemaVersion: 1, source: "custom", id: FIRST_ID },
  });
  const model = new MobileLayoutViewerModel();
  const controller = new CustomLayoutController(model, adapter, { crypto: webcrypto });
  await controller.initialize();
  const before = model.snapshot().presentation;

  await controller.removeLayout(`custom:${SECOND_ID}`);

  assert.equal(model.snapshot().selectedLayoutKey, `custom:${FIRST_ID}`);
  assert.equal(model.snapshot().presentation.name, before.name);
  assert.deepEqual(adapter.selection, { schemaVersion: 1, source: "custom", id: FIRST_ID });
  assert.deepEqual(adapter.records.map(({ id }) => id), [FIRST_ID]);
});

test("custom definitions drive Live layer, position, and combo mapping", async () => {
  const stored = await record();
  const adapter = new MemoryAdapter({ records: [stored], selection: { schemaVersion: 1, source: "custom", id: FIRST_ID } });
  const model = new MobileLayoutViewerModel();
  const controller = new CustomLayoutController(model, adapter, { crypto: webcrypto });
  await controller.initialize();
  const telemetry = new TelemetryModel(createTelemetrySnapshot(1, TelemetryStatus.LIVE, {
    activeLayer: 1,
    layerAuthoritative: true,
    pressedPositions: [0],
    activeCombos: [{ comboId: 7, positions: [0, 1], layer: 1 }],
  }));
  const presentation = new MobileLayoutPresentationController(model, telemetry);
  assert.equal(presentation.snapshot().presentation.layerName, "Fn");
  assert.deepEqual(presentation.snapshot().pressedPositions, [0]);
  assert.equal(presentation.snapshot().activeCombos[0].label, "Escape");
});

test("native adapter exposes only the bounded plugin contract and degrades when unavailable", async () => {
  const calls = [];
  const adapter = new NativeLayoutAdapter({ core: { invoke: async (...args) => { calls.push(args); return {}; } } });
  await adapter.pickLayout();
  await adapter.listRecords();
  await adapter.writeRecord({ id: FIRST_ID });
  await adapter.removeRecord(FIRST_ID);
  await adapter.readSelection();
  await adapter.writeSelection({ source: "bundled", id: "qwerty" });
  assert.deepEqual(calls.map(([command]) => command), [
    "plugin:keyboard-helper-layouts|pick_layout",
    "plugin:keyboard-helper-layouts|list_records",
    "plugin:keyboard-helper-layouts|write_record",
    "plugin:keyboard-helper-layouts|remove_record",
    "plugin:keyboard-helper-layouts|read_selection",
    "plugin:keyboard-helper-layouts|write_selection",
  ]);
  const unavailable = new NativeLayoutAdapter(null);
  assert.equal(unavailable.available, false);
  await assert.rejects(unavailable.pickLayout(), /unavailable/);
});

test("custom layout boundary contains no BLE, network, general filesystem, or browser storage authority", async () => {
  const sources = await Promise.all([
    "src-mobile/custom_layouts.js",
    "src-mobile/native_layout_adapter.js",
    "plugins/tauri-plugin-keyboard-helper-layouts/android/src/main/java/KeyboardHelperLayoutsPlugin.kt",
  ].map((file) => readFile(path.join(projectRoot, file), "utf8")));
  const source = sources.join("\n");
  assert.doesNotMatch(source, /Bluetooth|startScan|connectSelected|subscribeNotifications|writeCharacteristic/iu);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB/iu);
  assert.doesNotMatch(source, /MANAGE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/iu);
  assert.match(source, /Intent\.ACTION_OPEN_DOCUMENT/);
  assert.match(source, /activity\.filesDir/);
  assert.match(source, /CodingErrorAction\.REPORT/);
  assert.match(source, /MAX_IMPORT_BYTES = 524_288/);
  assert.match(source, /AtomicFile/);
});
