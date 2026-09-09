import assert from "node:assert/strict";
import test from "node:test";

import {
  LifecycleError,
  ReadyGattOperationSerializer,
} from "../src-mobile/ble_lifecycle.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("ready GATT operations run in deterministic order and release after enrollment", async () => {
  let generation = 4;
  const serializer = new ReadyGattOperationSerializer((candidate) => candidate === generation);
  const first = deferred();
  const calls = [];
  const read = serializer.run(4, async () => { calls.push("read-start"); await first.promise; calls.push("read-end"); return 81; });
  const enrollment = serializer.run(4, async () => { calls.push("enroll"); return "subscribed"; });
  const laterRead = serializer.run(4, async () => { calls.push("later-read"); return "model"; });

  await Promise.resolve();
  assert.deepEqual(calls, ["read-start"]);
  first.resolve();
  assert.equal(await read, 81);
  assert.equal(await enrollment, "subscribed");
  assert.equal(await laterRead, "model");
  assert.deepEqual(calls, ["read-start", "read-end", "enroll", "later-read"]);
});

test("generation invalidation rejects running commits and queued work before it starts", async () => {
  let generation = 2;
  const serializer = new ReadyGattOperationSerializer((candidate) => candidate === generation);
  const delayed = deferred();
  let queuedStarted = false;
  const running = serializer.run(2, () => delayed.promise);
  const queued = serializer.run(2, async () => { queuedStarted = true; });
  await Promise.resolve();
  generation = 3;
  serializer.invalidate();
  delayed.resolve("stale");

  await assert.rejects(running, (error) => error instanceof LifecycleError && error.code === "stale-operation");
  await assert.rejects(queued, (error) => error instanceof LifecycleError && error.code === "stale-operation");
  assert.equal(queuedStarted, false);
});

test("one failed operation does not poison later work", async () => {
  const serializer = new ReadyGattOperationSerializer((generation) => generation === 1);
  await assert.rejects(serializer.run(1, async () => { throw new Error("read failed"); }), /read failed/);
  assert.equal(await serializer.run(1, async () => "recovered"), "recovered");
});

test("dispose cancels queued work and repeated current-generation work remains valid", async () => {
  const serializer = new ReadyGattOperationSerializer((generation) => generation === 8);
  assert.equal(await serializer.run(8, async () => "first"), "first");
  assert.equal(await serializer.run(8, async () => "second"), "second");
  serializer.dispose();
  await assert.rejects(serializer.run(8, async () => "late"), (error) => error.code === "stale-operation");
});
