import assert from "node:assert/strict";
import test from "node:test";

import {
  createBleLayerSyncController,
  normalizeBleLayerSource,
} from "../src/ble_layer_sync.js";

test("normalizeBleLayerSource accepts valid BLE metadata", () => {
  const result = normalizeBleLayerSource({
    bleLayerSource: {
      deviceName: "Corney",
      serviceUuid: "12341234-1234-5678-7856-123412345678",
      characteristicUuid: "12341234-1234-5678-7856-123412345679",
      format: "int32-le",
    },
  });

  assert.deepEqual(result, {
    deviceName: "Corney",
    serviceUuid: "12341234-1234-5678-7856-123412345678",
    characteristicUuid: "12341234-1234-5678-7856-123412345679",
    format: "int32-le",
  });
});

test("normalizeBleLayerSource rejects incomplete metadata", () => {
  const result = normalizeBleLayerSource({
    bleLayerSource: {
      deviceName: "Corney",
      serviceUuid: "12341234-1234-5678-7856-123412345678",
    },
  });

  assert.equal(result, null);
});

function createTauriStub() {
  const listeners = new Map();
  const invokeCalls = [];

  return {
    invokeCalls,
    emit(name, payload) {
      for (const listener of listeners.get(name) ?? []) {
        listener({ payload });
      }
    },
    core: {
      async invoke(command, payload) {
        invokeCalls.push({ command, payload });
      },
    },
    event: {
      async listen(name, callback) {
        if (!listeners.has(name)) {
          listeners.set(name, []);
        }
        listeners.get(name).push(callback);
        return async () => {
          listeners.set(
            name,
            (listeners.get(name) ?? []).filter((entry) => entry !== callback),
          );
        };
      },
    },
  };
}

test("BLE controller starts sync and forwards authoritative layer updates", async () => {
  const tauri = createTauriStub();
  const seenLayers = [];
  const seenStatuses = [];
  const controller = createBleLayerSyncController({
    tauri,
    onLayerChange: (layer, meta) => seenLayers.push({ layer, meta }),
    onStatusChange: (status) => seenStatuses.push(status),
  });

  await controller.start("corney", {
    deviceName: "Corney",
    serviceUuid: "12341234-1234-5678-7856-123412345678",
    characteristicUuid: "12341234-1234-5678-7856-123412345679",
    format: "int32-le",
  });

  tauri.emit("ble_layer_update", { layout: "corney", layer: 3 });
  tauri.emit("ble_layer_status", { layout: "corney", state: "connected" });
  tauri.emit("ble_layer_update", { layout: "other", layer: 1 });

  assert.deepEqual(tauri.invokeCalls.map((call) => call.command), [
    "stop_ble_layer_sync",
    "start_ble_layer_sync",
  ]);
  assert.deepEqual(seenLayers, [{ layer: 3, meta: { source: "ble" } }]);
  assert.equal(seenStatuses.at(-1).state, "connected");
});

test("BLE controller falls back cleanly when no source is provided", async () => {
  const tauri = createTauriStub();
  const seenStatuses = [];
  const controller = createBleLayerSyncController({
    tauri,
    onLayerChange: () => {},
    onStatusChange: (status) => seenStatuses.push(status),
  });

  const started = await controller.start("qwerty", null);

  assert.equal(started, false);
  assert.deepEqual(tauri.invokeCalls.map((call) => call.command), ["stop_ble_layer_sync"]);
  assert.equal(seenStatuses.at(-1).state, "idle");
});
