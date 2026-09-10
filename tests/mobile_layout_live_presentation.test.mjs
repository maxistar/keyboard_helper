import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LayoutPresentationMode,
  MobileLayoutPresentationController,
  PRESENTATION_MISMATCH_LIMIT,
  resolveMobileLayoutPresentation,
} from "../src-mobile/layout_live_presentation.js";
import { MobileLayoutViewerModel } from "../src-mobile/layout_viewer_model.js";
import { createTelemetrySnapshot, TelemetryStatus } from "../src-mobile/telemetry_session.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class TelemetryModel {
  constructor(snapshot = createTelemetrySnapshot()) { this.state = snapshot; this.listeners = new Set(); }
  snapshot() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  publish(snapshot) { this.state = snapshot; for (const listener of this.listeners) listener(snapshot); }
}

function live(overrides = {}) {
  return createTelemetrySnapshot(1, TelemetryStatus.LIVE, {
    activeLayer: 1,
    layerAuthoritative: true,
    pressedPositions: [1],
    activeCombos: [{ comboId: 1, positions: [1, 2], layer: 1 }],
    ...overrides,
  });
}

test("Browse resolution preserves the exact model-owned presentation without BLE mutation", () => {
  const browseModel = new MobileLayoutViewerModel();
  browseModel.selectLayout("corne");
  browseModel.selectLayer(3);
  const browse = browseModel.snapshot();
  const result = resolveMobileLayoutPresentation(browse, live(), LayoutPresentationMode.BROWSE);
  assert.equal(result.mode, LayoutPresentationMode.BROWSE);
  assert.equal(result.presentation, browse.presentation);
  assert.equal(result.selectedLayerIndex, 3);
  assert.deepEqual(result.pressedPositions, []);
  assert.equal(Object.isFrozen(result), true);
});

test("controller enters Live at stream readiness and restores retained Browse exactly", () => {
  const browse = new MobileLayoutViewerModel();
  browse.selectLayout("corne");
  browse.selectLayer(3);
  const retained = browse.snapshot();
  const telemetry = new TelemetryModel(createTelemetrySnapshot(1, TelemetryStatus.AWAITING_STREAM_START));
  const controller = new MobileLayoutPresentationController(browse, telemetry);
  assert.equal(controller.snapshot().mode, LayoutPresentationMode.BROWSE);

  telemetry.publish(live());
  assert.equal(controller.snapshot().mode, LayoutPresentationMode.LIVE);
  assert.equal(controller.snapshot().selectedLayerIndex, 1);
  controller.selectMode(LayoutPresentationMode.BROWSE);
  assert.equal(controller.snapshot().presentation, retained.presentation);
  assert.equal(controller.snapshot().selectedLayerIndex, 3);

  telemetry.publish(live({ activeLayer: 2, pressedPositions: [7] }));
  assert.equal(controller.snapshot().mode, LayoutPresentationMode.BROWSE);
  controller.selectMode(LayoutPresentationMode.LIVE);
  assert.equal(controller.snapshot().selectedLayerIndex, 2);
  assert.deepEqual(controller.snapshot().pressedPositions, [7]);
});

test("disconnect fallback and cold process recreation reveal only process-local Browse state", () => {
  const browse = new MobileLayoutViewerModel();
  browse.selectLayout("corne");
  browse.selectLayer(2);
  const telemetry = new TelemetryModel(live());
  const controller = new MobileLayoutPresentationController(browse, telemetry);
  telemetry.publish(createTelemetrySnapshot(2, TelemetryStatus.STALE));
  assert.equal(controller.snapshot().mode, LayoutPresentationMode.BROWSE);
  assert.equal(controller.snapshot().selectedLayerIndex, 2);

  const recreated = new MobileLayoutPresentationController(new MobileLayoutViewerModel(), new TelemetryModel());
  assert.equal(recreated.snapshot().mode, LayoutPresentationMode.BROWSE);
  assert.equal(recreated.snapshot().selectedLayoutKey, "qwerty");
  assert.equal(recreated.snapshot().selectedLayerIndex, 0);
});

test("only authoritative layer state selects persistent Live layers", () => {
  const browse = new MobileLayoutViewerModel();
  browse.selectLayout("corne");
  browse.selectLayer(3);
  const contextualOnly = resolveMobileLayoutPresentation(
    browse.snapshot(),
    live({ activeLayer: null, layerAuthoritative: false, activeCombos: [{ comboId: 1, positions: [1, 2], layer: 18 }] }),
    LayoutPresentationMode.LIVE,
  );
  assert.equal(contextualOnly.selectedLayerIndex, 3);
  assert.equal(contextualOnly.activeCombos[0].contextualLayer, 18);
});

test("current bundled layout alone maps exact positions and combo metadata", () => {
  const browse = new MobileLayoutViewerModel();
  browse.selectLayout("corne");
  const result = resolveMobileLayoutPresentation(
    browse.snapshot(), live({ pressedPositions: [1, 99], activeCombos: [
      { comboId: 1, positions: [1, 2], layer: 1 },
      { comboId: 999, positions: [3, 100], layer: 1 },
    ] }), LayoutPresentationMode.LIVE,
  );
  assert.deepEqual(result.pressedPositions, [1]);
  assert.deepEqual(result.comboPositions, [1, 2, 3]);
  assert.equal(result.activeCombos[0].label, "Escape");
  assert.equal(result.activeCombos[0].matched, true);
  assert.equal(result.activeCombos[1].matched, false);
  assert.ok(result.mismatches.some(({ kind, position }) => kind === "position" && position === 99));
  assert.ok(result.mismatches.some(({ kind, comboId }) => kind === "combo" && comboId === 999));
  assert.ok(result.mismatches.length <= PRESENTATION_MISMATCH_LIMIT);
});

test("invalid Live layers preserve geometry and never select unrelated layout metadata", () => {
  const browse = new MobileLayoutViewerModel();
  browse.selectLayout("corne");
  browse.selectLayer(2);
  const result = resolveMobileLayoutPresentation(
    browse.snapshot(), live({ activeLayer: 99 }), LayoutPresentationMode.LIVE,
  );
  assert.equal(result.selectedLayerIndex, 2);
  assert.equal(result.presentation, browse.snapshot().presentation);
  assert.deepEqual(result.mismatches[0], { kind: "layer", layer: 99 });
});

test("repeated identical snapshots are deterministic and source isolation remains explicit", async () => {
  const browse = new MobileLayoutViewerModel();
  browse.selectLayout("corne");
  const first = resolveMobileLayoutPresentation(browse.snapshot(), live(), LayoutPresentationMode.LIVE);
  const second = resolveMobileLayoutPresentation(browse.snapshot(), live(), LayoutPresentationMode.LIVE);
  assert.deepEqual(first, second);

  const [browseSource, presentationSource] = await Promise.all([
    readFile(path.join(projectRoot, "src-mobile/layout_viewer_model.js"), "utf8"),
    readFile(path.join(projectRoot, "src-mobile/layout_live_presentation.js"), "utf8"),
  ]);
  assert.doesNotMatch(browseSource, /ble_lifecycle|telemetry_session|subscribeNotifications|CapabilityMode/u);
  assert.doesNotMatch(presentationSource, /write\(|connectSelected|startScan|localStorage|sessionStorage|indexedDB|fetch\(/u);
});
