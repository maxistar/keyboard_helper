import assert from "node:assert/strict";
import test from "node:test";

import {
  BLE_KEYBOARD_CAPABILITY_FLAGS,
  BLE_KEYBOARD_EVENT_TYPES,
  BLE_KEYBOARD_FRAME_FLAGS,
  BLE_KEYBOARD_PROTOCOL,
  BLE_KEYBOARD_UUIDS,
  DECODER_OUTCOME,
  decodeBleKeyboardCapabilities,
  decodeBleKeyboardFrame,
} from "../src/ble_keyboard_decoder.js";
import { readJsonFixture } from "./fixture_helpers.mjs";

const fixture = readJsonFixture("ble/keyboard-events-v1.json");

function bytes(hex) {
  return Uint8Array.from(hex.match(/../gu) ?? [], (value) => Number.parseInt(value, 16));
}

function mutate(hex, update) {
  const value = bytes(hex);
  update(value);
  return value;
}

const capabilitiesResult = decodeBleKeyboardCapabilities(bytes(fixture.capabilities.hex));
const capabilities = capabilitiesResult.value;

test("BLE v1 constants and decoder outcomes are immutable and normalized", () => {
  assert.equal(Object.isFrozen(BLE_KEYBOARD_UUIDS), true);
  assert.equal(Object.isFrozen(BLE_KEYBOARD_PROTOCOL), true);
  assert.equal(Object.isFrozen(BLE_KEYBOARD_CAPABILITY_FLAGS), true);
  assert.equal(Object.isFrozen(BLE_KEYBOARD_FRAME_FLAGS), true);
  assert.equal(Object.isFrozen(BLE_KEYBOARD_EVENT_TYPES), true);
  assert.equal(Object.isFrozen(DECODER_OUTCOME), true);
  assert.equal(Object.isFrozen(capabilitiesResult), true);
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(Object.isFrozen(capabilities.features), true);
  assert.equal(JSON.stringify(capabilitiesResult).includes("raw"), false);
  assert.equal(BLE_KEYBOARD_UUIDS.events, "b34a0004-e782-4706-8f9c-6c056c416507");
});

test("capability decoder accepts compatible minor versions and ignores reserved flag bits", () => {
  const value = mutate(fixture.capabilities.hex, (data) => {
    data[1] = 9;
    data[2] |= 1 << fixture.reserved.capabilityBit;
    data[3] = 0x80;
  });
  const result = decodeBleKeyboardCapabilities(value);
  assert.equal(result.status, DECODER_OUTCOME.decoded);
  assert.equal(result.value.protocolMinor, 9);
  assert.deepEqual(result.value.features, {
    keyEvents: true,
    comboEvents: true,
    layerEvents: true,
    diagnostics: true,
    legacyLayerRegister: true,
    legacyLayerWrite: true,
  });
  assert.equal(Object.hasOwn(result.value, "flags"), false);
});

test("capability decoder rejects malformed input and bounds", () => {
  const cases = [
    ["invalid bytes", [1, -1], "invalid-byte-input"],
    ["truncated", bytes("01007700"), "invalid-capabilities-length"],
    ["oversized", bytes("010077001401000000"), "invalid-capabilities-length"],
    ["unsupported major", mutate(fixture.capabilities.hex, (data) => { data[0] = 2; }), "unsupported-protocol-major"],
    ["frame too short", mutate(fixture.capabilities.hex, (data) => { data[4] = 7; }), "invalid-capabilities-bounds"],
    ["frame too long", mutate(fixture.capabilities.hex, (data) => { data[4] = 21; }), "invalid-capabilities-bounds"],
    ["position schema", mutate(fixture.capabilities.hex, (data) => { data[5] = 2; }), "invalid-capabilities-bounds"],
    ["reserved bytes", mutate(fixture.capabilities.hex, (data) => { data[7] = 1; }), "invalid-capabilities-bounds"],
  ];
  for (const [name, value, code] of cases) {
    assert.equal(decodeBleKeyboardCapabilities(value).issue?.code, code, name);
  }
});

test("JavaScript decoding agrees with canonical Rust/desktop fixture interpretation", () => {
  const expected = {
    "key-down": { kind: "key", action: "down", position: 1, layer: 1 },
    "combo-activated": { kind: "combo", action: "down", comboId: 1, positions: [1, 2], layer: 1 },
    "stream-start-layer-snapshot": { kind: "layer", layer: 1, previousLayer: 1, cause: 3, originPosition: 255 },
    "queue-overflow-diagnostic": { kind: "diagnostic", code: 1, severity: 1, diagnosticSource: 0, count: 3, detail: 48 },
  };

  for (const item of fixture.events) {
    const result = decodeBleKeyboardFrame(bytes(item.hex), capabilities);
    assert.equal(result.status, DECODER_OUTCOME.decoded, item.name);
    assert.equal(result.value.sequence, item.decoded.sequence, item.name);
    assert.equal(result.value.streamStart, Boolean(item.decoded.flags & BLE_KEYBOARD_FRAME_FLAGS.streamStart), item.name);
    const event = Object.fromEntries(
      Object.entries(result.value).filter(([key]) => !["source", "sequence", "streamStart"].includes(key)),
    );
    assert.deepEqual(event, expected[item.name], item.name);
    assert.equal(Object.isFrozen(result.value), true, item.name);
    if (event.positions) assert.equal(Object.isFrozen(event.positions), true, item.name);
  }
});

test("frame decoder handles little-endian sequence and exact advertised boundary", () => {
  const boundary = bytes("0105000cffffffff010001000300000030000000");
  const result = decodeBleKeyboardFrame(boundary, capabilities);
  assert.equal(result.value.sequence, 0xffffffff);
  assert.equal(boundary.length, capabilities.maxFrameLength);
  assert.equal(result.status, DECODER_OUTCOME.decoded);
});

test("unknown and reserved well-formed event types are skipped after envelope validation", () => {
  for (const [eventType, reason] of [[0x04, "reserved-event-type"], [0x80, "unknown-event-type"]]) {
    const result = decodeBleKeyboardFrame(Uint8Array.from([1, eventType, 0, 2, 7, 0, 0, 0, 0xaa, 0xbb]), capabilities);
    assert.equal(result.status, DECODER_OUTCOME.skipped);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.envelope, { eventType, flags: 0, sequence: 7 });
  }
});

test("frame decoder rejects malformed, truncated, oversized, and invalid known frames", () => {
  const key = fixture.events.find(({ name }) => name === "key-down").hex;
  const combo = fixture.events.find(({ name }) => name === "combo-activated").hex;
  const layer = fixture.events.find(({ name }) => name === "stream-start-layer-snapshot").hex;
  const diagnostic = fixture.events.find(({ name }) => name === "queue-overflow-diagnostic").hex;
  const cases = [
    ["truncated header", bytes("010100032a0000"), "invalid-frame-length"],
    ["declared mismatch", mutate(key, (data) => { data[3] = 4; }), "invalid-payload-length"],
    ["advertised maximum", bytes(diagnostic), "invalid-frame-length", { ...capabilities, maxFrameLength: 19 }],
    ["absolute maximum", Uint8Array.from({ length: 21 }, (_, index) => index === 0 ? 1 : 0), "invalid-frame-length"],
    ["unsupported major", mutate(key, (data) => { data[0] = 2; }), "unsupported-protocol-major"],
    ["reserved flags", mutate(key, (data) => { data[2] = 0x08; }), "invalid-frame-flags"],
    ["key action", mutate(key, (data) => { data[8] = 2; }), "invalid-action"],
    ["combo id", mutate(combo, (data) => { data[8] = 0; data[9] = 0; }), "invalid-combo"],
    ["combo count", mutate(combo, (data) => { data[12] = 5; }), "invalid-combo"],
    ["layer cause", mutate(layer, (data) => { data[10] = 4; }), "invalid-layer-cause"],
    ["diagnostic severity", mutate(diagnostic, (data) => { data[10] = 3; }), "invalid-diagnostic-severity"],
  ];
  for (const [name, value, code, advertised = capabilities] of cases) {
    const result = decodeBleKeyboardFrame(value, advertised);
    assert.equal(result.status, DECODER_OUTCOME.rejected, name);
    assert.equal(result.issue.code, code, name);
    assert.equal(JSON.stringify(result).includes("raw"), false, name);
  }
});
