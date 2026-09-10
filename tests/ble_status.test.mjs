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
  assert.equal(status.detail, "stock ZMK · extension-capabilities-unavailable");
  assert.equal(status.battery, "Battery unavailable");
});

test("capability read diagnostics remain visible in unsupported mode", () => {
  const reason = "extension-capabilities-invalid: InvalidCapabilitiesLength(3); received 3 bytes [01 00 77]";
  const status = formatBleKeyboardStatus(
    { effectiveSource: "system", reason },
    { mode: "unsupported", reason },
    87,
  );
  assert.equal(status.detail, `unsupported extension · ${reason}`);
  assert.equal(status.battery, "Battery 87%");
});

test("fresh backend diagnostics override stale input-source fallback reasons", () => {
  const status = formatBleKeyboardStatus(
    { effectiveSource: "system", reason: "extension-event-stream-unavailable" },
    {
      mode: "unsupported",
      reason: "extension-event-subscribe-failed: insufficient encryption",
    },
  );
  assert.equal(
    status.detail,
    "unsupported extension · extension-event-subscribe-failed: insufficient encryption",
  );
});

test("subscription capacity diagnostics remain generic and preserve fallback", () => {
  const reason =
    "extension-event-subscription-capacity-unavailable: Operation failed with ATT error: 0x11";
  const status = formatBleKeyboardStatus(
    { effectiveSource: "system", reason: "extension-event-stream-unavailable" },
    { mode: "unsupported", reason },
    100,
  );
  assert.equal(status.summary, "Active: System listener");
  assert.equal(status.detail, `unsupported extension · ${reason}`);
  assert.equal(status.battery, "Battery 100%");
});
