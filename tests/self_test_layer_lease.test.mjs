import assert from "node:assert/strict";
import test from "node:test";

import {
  createSelfTestLayerLeaseCoordinator,
  matchesOrderedLayerRequest,
} from "../src/self_test/layer_lease.js";

function harness({ writable = true, failWrite = null, validateLayerRequest = () => true } = {}) {
  let activeLayoutKey = "corney";
  let observedLayer = 4;
  const writes = [];
  const suspension = [];
  const statuses = [];
  const coordinator = createSelfTestLayerLeaseCoordinator({
    getActiveLayoutKey: () => activeLayoutKey,
    getObservedLayer: () => observedLayer,
    isWritable: () => writable,
    validateLayerRequest,
    writeLayer: async (layer) => {
      writes.push(layer);
      if (failWrite) throw new Error(failWrite);
      observedLayer = layer;
    },
    setReconciliationSuspended: (suspended) => suspension.push(suspended),
    onStatus: (status) => statuses.push(status),
  });
  return {
    coordinator,
    writes,
    suspension,
    statuses,
    setObservedLayer(layer) { observedLayer = layer; },
    setActiveLayoutKey(layoutKey) { activeLayoutKey = layoutKey; },
  };
}

const request = { generation: 7, layoutKey: "corney", layerKey: "Mac: Shift", firmwareLayerIndex: 5 };

test("acquires a generation-scoped lease after confirmed layer selection", async () => {
  const subject = harness();
  assert.equal(await subject.coordinator.acquire(request), true);
  assert.deepEqual(subject.writes, [5]);
  assert.deepEqual(subject.suspension, [true]);
  assert.deepEqual(subject.coordinator.getState(), {
    generation: 7,
    layoutKey: "corney",
    layerKey: "Mac: Shift",
    requestedLayer: 5,
    previousLayer: 4,
    state: "active",
    message: null,
  });
});

test("rejects invalid requests and stale generation operations", async () => {
  const subject = harness();
  assert.equal(await subject.coordinator.acquire({ ...request, layoutKey: "other" }), false);
  assert.equal(await subject.coordinator.acquire(request), true);
  assert.equal(await subject.coordinator.reassert(6), false);
  assert.equal(await subject.coordinator.release(6), false);
  assert.deepEqual(subject.writes, [5]);
});

test("ordered layer validation requires matching raw identity and ordinal", () => {
  const layerKeys = ["Default", "Linux: Default", "Mac: Shift"];
  assert.equal(matchesOrderedLayerRequest(layerKeys, {
    layerKey: "Mac: Shift", firmwareLayerIndex: 2,
  }), true);
  assert.equal(matchesOrderedLayerRequest(layerKeys, {
    layerKey: "Mac: Shift", firmwareLayerIndex: 1,
  }), false);
  assert.equal(matchesOrderedLayerRequest(layerKeys, {
    layerKey: "Missing", firmwareLayerIndex: 2,
  }), false);
});

test("rejects a request that does not match the overlay-owned layer order", async () => {
  const subject = harness({ validateLayerRequest: (candidate) => candidate.firmwareLayerIndex === 5 });
  assert.equal(await subject.coordinator.acquire({ ...request, firmwareLayerIndex: 18 }), false);
  assert.deepEqual(subject.writes, []);
  assert.match(subject.statuses.at(-1).message, /does not match/);
});

test("reports layer loss and reasserts only for the owning generation", async () => {
  const subject = harness();
  await subject.coordinator.acquire(request);
  subject.setObservedLayer(2);
  subject.coordinator.observeLayer(2);
  assert.equal(subject.coordinator.getState().state, "lost");
  assert.equal(await subject.coordinator.reassert(7), true);
  assert.deepEqual(subject.writes, [5, 5]);
  assert.equal(subject.coordinator.getState().state, "active");
});

test("release restores the previous layer only while the lease still owns its requested layer", async () => {
  const owned = harness();
  await owned.coordinator.acquire(request);
  assert.equal(await owned.coordinator.release(7), true);
  assert.deepEqual(owned.writes, [5, 4]);
  assert.deepEqual(owned.suspension, [true, false]);
  assert.equal(owned.coordinator.getState(), null);

  const superseded = harness();
  await superseded.coordinator.acquire(request);
  superseded.setObservedLayer(9);
  assert.equal(await superseded.coordinator.release(7), true);
  assert.deepEqual(superseded.writes, [5]);
  assert.deepEqual(superseded.suspension, [true, false]);
});

test("explicit invalidation never restores stale state", async () => {
  const subject = harness();
  await subject.coordinator.acquire(request);
  subject.setObservedLayer(9);
  subject.coordinator.invalidate("layout-changed");
  assert.deepEqual(subject.writes, [5]);
  assert.equal(subject.coordinator.getState(), null);
  assert.equal(subject.statuses.at(-1).state, "invalidated");
});

test("write failures remain explicit and release reconciliation on stop", async () => {
  const subject = harness({ failWrite: "confirmation timeout" });
  assert.equal(await subject.coordinator.acquire(request), false);
  assert.equal(subject.coordinator.getState().state, "error");
  assert.match(subject.coordinator.getState().message, /confirmation timeout/);
  await subject.coordinator.release(7);
  assert.deepEqual(subject.suspension, [true, false]);
});
