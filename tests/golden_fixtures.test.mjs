import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeConfig,
  parseExternalLayout,
  validateConfigDraft,
} from "../src/app_config.js";
import { normalizeBleLayerSource } from "../src/ble_layer_sync.js";
import { normalizeInputSourceSync } from "../src/input_source_sync_config.js";
import { readFixture, readJsonFixture } from "./fixture_helpers.mjs";

test("golden baseline and external configurations normalize consistently", () => {
  const baseline = normalizeConfig(readJsonFixture("configs/baseline.json"));
  assert.equal(baseline.defaultLayout, "qwerty");
  assert.equal(validateConfigDraft(baseline).valid, true);

  const external = normalizeConfig(readJsonFixture("configs/external.json"));
  assert.equal(external.defaultLayout, "external");
  assert.equal(validateConfigDraft(external).valid, true);
});

test("golden malformed configuration remains invalid for the documented reasons", () => {
  const malformed = readJsonFixture("configs/malformed.json");
  const result = validateConfigDraft(malformed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.defaultLayout);
  assert.ok(result.errors.layouts);
});

test("golden layout fixtures are accepted by the external layout parser", () => {
  for (const fixture of [
    "layouts/qwerty-minimal.json",
    "layouts/corne-connected.json",
    "layouts/external-minimal.json",
  ]) {
    assert.equal(parseExternalLayout(readFixture(fixture)).valid, true, fixture);
  }
});

test("golden Corne fixture exercises layer, combo, BLE, and input-source contracts", () => {
  const corne = readJsonFixture("layouts/corne-connected.json");
  assert.equal(Object.keys(corne.keyLayers).length, 5);
  assert.equal(corne.combos[0].id, "escape-combo");
  assert.equal(normalizeBleLayerSource(corne)?.format, "int32-le");
  assert.equal(normalizeInputSourceSync(corne, 5, { platform: "macos" }).error, null);
});

test("golden BLE states distinguish read-only and writable sessions", () => {
  assert.equal(readJsonFixture("ble/read-only-session.json").writable, false);
  assert.equal(readJsonFixture("ble/writable-session.json").writable, true);
});
