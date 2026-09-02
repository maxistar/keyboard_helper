import assert from "node:assert/strict";
import test from "node:test";

import { readJsonFixture } from "../fixture_helpers.mjs";

const fixture = readJsonFixture("ble/keyboard-events-v1.json");

function bytes(hex) {
  assert.match(hex, /^(?:[0-9a-f]{2})+$/u);
  return Uint8Array.from(hex.match(/../gu), (value) => Number.parseInt(value, 16));
}

test("BLE v1 fixture preserves capabilities and standard battery boundary", () => {
  const capabilities = bytes(fixture.capabilities.hex);
  assert.equal(capabilities.length, 8);
  assert.deepEqual([...capabilities.slice(0, 2)], [1, 0]);
  assert.equal(capabilities[2] | (capabilities[3] << 8), fixture.capabilities.flags);
  assert.equal((fixture.capabilities.flags & (1 << fixture.reserved.capabilityBit)) === 0, true);
  assert.equal(capabilities[4], fixture.capabilities.maxFrameSize);
  assert.equal(capabilities[5], fixture.capabilities.positionSchema);
  assert.deepEqual([...capabilities.slice(6)], [0, 0]);
  assert.equal(fixture.battery.serviceUuid, "180f");
  assert.equal(fixture.battery.levelCharacteristicUuid, "2a19");
  assert.equal(fixture.battery.extensionEventType, null);
});

test("BLE v1 fixture frames are bounded, self-sized, and skip reserved type 4", () => {
  assert.deepEqual(fixture.events.map(({ decoded }) => decoded.type), [1, 2, 3, 5]);

  for (const event of fixture.events) {
    const frame = bytes(event.hex);
    assert.equal(frame[0], 1, event.name);
    assert.equal(frame[1], event.decoded.type, event.name);
    assert.equal(frame[2], event.decoded.flags, event.name);
    assert.equal(frame.length, 8 + frame[3], event.name);
    assert.ok(frame.length <= fixture.capabilities.maxFrameSize, event.name);
    assert.notEqual(frame[1], fixture.reserved.eventType, event.name);
    assert.equal(
      frame[4] | (frame[5] << 8) | (frame[6] << 16) | (frame[7] << 24),
      event.decoded.sequence,
      event.name,
    );
  }
});

test("BLE v1 fixture contains no text or HID payload contract", () => {
  const serialized = JSON.stringify(fixture.events);
  for (const field of fixture.prohibitedPayloadFields) {
    assert.equal(serialized.includes(`"${field}"`), false, field);
  }
});
