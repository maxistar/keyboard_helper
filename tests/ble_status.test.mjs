import assert from "node:assert/strict";
import test from "node:test";

import { formatBleKeyboardStatus } from "../src/ble_status.js";

test("status distinguishes configured policy, effective source, extension mode, and BAS battery", () => {
  assert.deepEqual(formatBleKeyboardStatus(
    { configuredPolicy: "auto", effectiveSource: "ble", reason: null },
    { mode: "enhanced", reason: null },
    87,
  ), {
    summary: "Auto · Active: BLE",
    detail: "extension v1",
    battery: "Battery 87%",
  });
});

test("forced BLE unavailability and stock ZMK limitations remain visible", () => {
  const status = formatBleKeyboardStatus(
    { configuredPolicy: "ble", effectiveSource: null, reason: "ble-capabilities-unavailable" },
    { mode: "stock", reason: "extension-capabilities-unavailable" },
  );
  assert.equal(status.summary, "BLE · Active: Unavailable");
  assert.equal(status.detail, "stock ZMK · ble-capabilities-unavailable");
  assert.equal(status.battery, "Battery unavailable");
});
