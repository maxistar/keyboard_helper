import assert from "node:assert/strict";
import test from "node:test";

import { formatBleKeyboardStatus } from "../src/ble_status.js";

test("status distinguishes effective source, extension mode, and BAS battery", () => {
  assert.deepEqual(formatBleKeyboardStatus(
    { effectiveSource: "ble", reason: null },
    { mode: "enhanced", reason: null },
    87,
  ), {
    summary: "Active: BLE",
    detail: "extension v1",
    battery: "Battery 87%",
  });
});

test("automatic fallback and stock ZMK limitations remain visible", () => {
  const status = formatBleKeyboardStatus(
    { effectiveSource: "system", reason: "ble-capabilities-unavailable" },
    { mode: "stock", reason: "extension-capabilities-unavailable" },
  );
  assert.equal(status.summary, "Active: System listener");
  assert.equal(status.detail, "stock ZMK · ble-capabilities-unavailable");
  assert.equal(status.battery, "Battery unavailable");
});
