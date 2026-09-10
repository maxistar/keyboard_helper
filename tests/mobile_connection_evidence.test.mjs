import assert from "node:assert/strict";
import test from "node:test";

import { LifecyclePhase } from "../src-mobile/ble_lifecycle.js";
import {
  ConnectionEvidenceController,
  decodeBatteryEvidence,
  decodeTextEvidence,
  DEVICE_INFORMATION_FIELDS,
  EvidenceStatus,
  EvidenceValueStatus,
  STANDARD_SERVICE_UUIDS,
  STANDARD_TEXT_LIMIT,
} from "../src-mobile/connection_evidence.js";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function service(uuid, characteristicUuids) {
  return { uuid, characteristics: characteristicUuids.map((characteristicUuid) => ({ uuid: characteristicUuid })) };
}

class FakeCoordinator {
  constructor() {
    this.state = { phase: LifecyclePhase.IDLE, generation: 0 };
    this.listeners = new Set();
    this.services = [];
    this.values = new Map();
    this.failures = new Set();
    this.calls = [];
    this.activeReads = 0;
    this.maxActiveReads = 0;
  }

  snapshot() { return this.state; }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  transition(state) { this.state = state; for (const listener of this.listeners) listener(state); }
  async read(serviceUuid, characteristicUuid) {
    this.calls.push([serviceUuid, characteristicUuid]);
    this.activeReads += 1;
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
    const key = `${serviceUuid}/${characteristicUuid}`;
    try {
      if (this.failures.has(key)) throw new Error(`private native failure for ${key}`);
      return await this.values.get(key);
    } finally {
      this.activeReads -= 1;
    }
  }
}

const textBytes = (value) => [...new TextEncoder().encode(value)];
const keyFor = (serviceUuid, characteristicUuid) => `${serviceUuid}/${characteristicUuid}`;

function readyCoordinator({ battery = [81], fields = {} } = {}) {
  const coordinator = new FakeCoordinator();
  coordinator.services = [
    service(STANDARD_SERVICE_UUIDS.batteryService, [STANDARD_SERVICE_UUIDS.batteryLevel]),
    service(STANDARD_SERVICE_UUIDS.deviceInformationService, DEVICE_INFORMATION_FIELDS.map(({ characteristicUuid }) => characteristicUuid)),
  ];
  coordinator.values.set(keyFor(STANDARD_SERVICE_UUIDS.batteryService, STANDARD_SERVICE_UUIDS.batteryLevel), battery);
  for (const field of DEVICE_INFORMATION_FIELDS) {
    coordinator.values.set(
      keyFor(STANDARD_SERVICE_UUIDS.deviceInformationService, field.characteristicUuid),
      textBytes(fields[field.key] ?? `${field.label} value`),
    );
  }
  return coordinator;
}

test("battery and Device Information decoders are strict, bounded, and immutable", () => {
  assert.deepEqual(decodeBatteryEvidence([81]), { status: EvidenceValueStatus.AVAILABLE, value: 81, diagnostic: null });
  for (const invalid of [[], [1, 2], [101], [-1], [1.5]]) {
    assert.equal(decodeBatteryEvidence(invalid).status, EvidenceValueStatus.MALFORMED);
  }
  const text = decodeTextEvidence(textBytes(`  Model\u0000  ${"x".repeat(120)} `), "Model");
  assert.equal(text.status, EvidenceValueStatus.AVAILABLE);
  assert.ok(text.value.length <= STANDARD_TEXT_LIMIT);
  assert.equal(text.value.includes("\u0000"), false);
  assert.equal(decodeTextEvidence([0xff], "Model").status, EvidenceValueStatus.MALFORMED);
  assert.ok(Object.isFrozen(text));
});

test("a full ready generation reads only the fixed standard allowlist", async () => {
  const coordinator = readyCoordinator({ fields: { manufacturer: "ZMK", model: "Corne" } });
  const evidence = new ConnectionEvidenceController(coordinator);
  coordinator.transition({ phase: LifecyclePhase.READY, generation: 7 });
  await evidence.whenSettled();

  assert.equal(evidence.snapshot().generation, 7);
  assert.equal(evidence.snapshot().status, EvidenceStatus.AVAILABLE);
  assert.equal(evidence.snapshot().battery.value, 81);
  assert.equal(evidence.snapshot().deviceInformation.model.value, "Corne");
  assert.equal(coordinator.calls.length, 1 + DEVICE_INFORMATION_FIELDS.length);
  assert.equal(coordinator.maxActiveReads, 1);
  assert.deepEqual(coordinator.calls, [
    [STANDARD_SERVICE_UUIDS.batteryService, STANDARD_SERVICE_UUIDS.batteryLevel],
    ...DEVICE_INFORMATION_FIELDS.map(({ characteristicUuid }) => [
      STANDARD_SERVICE_UUIDS.deviceInformationService,
      characteristicUuid,
    ]),
  ]);
  const calledUuids = JSON.stringify(coordinator.calls);
  for (const forbidden of ["00002a25", "00002a23", "00002a2a", "00002a50"]) {
    assert.equal(calledUuids.includes(forbidden), false);
  }
  assert.equal(calledUuids.includes("private native failure"), false);
});

test("absent and partial standard services remain honest independent evidence", async () => {
  const absentCoordinator = new FakeCoordinator();
  const absent = new ConnectionEvidenceController(absentCoordinator);
  absentCoordinator.transition({ phase: LifecyclePhase.READY, generation: 1 });
  await absent.whenSettled();
  assert.equal(absent.snapshot().status, EvidenceStatus.UNAVAILABLE);
  assert.equal(absent.snapshot().battery.status, EvidenceValueStatus.ABSENT);
  assert.equal(absentCoordinator.calls.length, 0);

  const partialCoordinator = readyCoordinator({ battery: [250], fields: { model: "Corne" } });
  const failedField = DEVICE_INFORMATION_FIELDS.find(({ key }) => key === "firmware");
  partialCoordinator.failures.add(keyFor(STANDARD_SERVICE_UUIDS.deviceInformationService, failedField.characteristicUuid));
  partialCoordinator.services[1] = service(
    STANDARD_SERVICE_UUIDS.deviceInformationService,
    DEVICE_INFORMATION_FIELDS.filter(({ key }) => key !== "hardware").map(({ characteristicUuid }) => characteristicUuid),
  );
  const partial = new ConnectionEvidenceController(partialCoordinator);
  partialCoordinator.transition({ phase: LifecyclePhase.READY, generation: 2 });
  await partial.whenSettled();
  assert.equal(partial.snapshot().status, EvidenceStatus.PARTIAL);
  assert.equal(partial.snapshot().battery.status, EvidenceValueStatus.MALFORMED);
  assert.equal(partial.snapshot().deviceInformation.model.value, "Corne");
  assert.equal(partial.snapshot().deviceInformation.firmware.status, EvidenceValueStatus.FAILED);
  assert.equal(partial.snapshot().deviceInformation.hardware.status, EvidenceValueStatus.ABSENT);
  assert.doesNotMatch(partial.snapshot().deviceInformation.firmware.diagnostic, /private native failure/);
});

test("generation changes clear evidence and reject stale out-of-order completions", async () => {
  const coordinator = readyCoordinator();
  const delayed = deferred();
  coordinator.values.set(keyFor(STANDARD_SERVICE_UUIDS.batteryService, STANDARD_SERVICE_UUIDS.batteryLevel), delayed.promise);
  const evidence = new ConnectionEvidenceController(coordinator);
  coordinator.transition({ phase: LifecyclePhase.READY, generation: 3 });
  assert.equal(evidence.snapshot().status, EvidenceStatus.LOADING);

  coordinator.transition({ phase: LifecyclePhase.DISCONNECTED, generation: 4 });
  assert.equal(evidence.snapshot().status, EvidenceStatus.IDLE);
  assert.equal(evidence.snapshot().generation, 4);
  delayed.resolve([42]);
  await evidence.whenSettled();
  assert.equal(evidence.snapshot().status, EvidenceStatus.IDLE);
  assert.equal(evidence.snapshot().battery.value, null);
});

test("non-ready transitions never initiate standard reads", () => {
  const coordinator = readyCoordinator();
  const evidence = new ConnectionEvidenceController(coordinator);
  for (const phase of [LifecyclePhase.SCANNING, LifecyclePhase.CONNECTING, LifecyclePhase.DISCOVERING]) {
    coordinator.transition({ phase, generation: coordinator.state.generation + 1 });
  }
  assert.equal(coordinator.calls.length, 0);
  assert.equal(evidence.snapshot().status, EvidenceStatus.IDLE);
});
