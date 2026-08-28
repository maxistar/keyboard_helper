import assert from "node:assert/strict";
import test from "node:test";

import { createMacosInputSourceController } from "../src/macos_input_source.js";

function fakeTauri(snapshot = {}) {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    listeners,
    core: {
      async invoke(command, args) {
        calls.push([command, args]);
        if (command === "start_macos_input_source_sync" || command === "refresh_macos_input_source_sync") {
          return {
            currentSourceId: "com.apple.keylayout.German",
            availableSourceIds: ["com.apple.keylayout.German"],
            ...snapshot,
          };
        }
        return null;
      },
    },
    event: {
      async listen(name, listener) {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
    },
  };
}

const config = {
  sources: [
    { inputSourceId: "com.apple.keylayout.German" },
    { inputSourceId: "com.apple.keylayout.Russian" },
  ],
};

test("reports bootstrap source and configured availability", async () => {
  const tauri = fakeTauri();
  const sources = [];
  const availability = [];
  const controller = createMacosInputSourceController({
    tauri,
    onSourceChange: (source) => sources.push(source),
    onAvailabilityChange: (ids) => availability.push([...ids]),
  });

  assert.equal(await controller.start("corney", config), true);
  assert.deepEqual(sources, ["com.apple.keylayout.German"]);
  assert.deepEqual(availability.at(-1), ["com.apple.keylayout.German"]);
  assert.deepEqual(tauri.calls.at(-1)[1].config.sourceIds, [
    "com.apple.keylayout.German",
    "com.apple.keylayout.Russian",
  ]);
});

test("rejects unavailable selection without invoking native selection", async () => {
  const tauri = fakeTauri();
  const controller = createMacosInputSourceController({ tauri, onSourceChange() {} });
  await controller.start("corney", config);
  await assert.rejects(
    controller.select("com.apple.keylayout.Russian"),
    /unavailable/,
  );
  assert.equal(tauri.calls.some(([command]) => command === "select_macos_input_source"), false);
});

test("direct selection requires native confirmation", async () => {
  const tauri = fakeTauri({
    currentSourceId: "com.apple.keylayout.German",
    availableSourceIds: ["com.apple.keylayout.German", "com.apple.keylayout.Russian"],
  });
  const controller = createMacosInputSourceController({ tauri, onSourceChange() {} });
  await controller.start("corney", config);
  await assert.rejects(
    controller.select("com.apple.keylayout.Russian"),
    /did not confirm/,
  );
});

test("direct selection succeeds only after the requested source is reported", async () => {
  const tauri = fakeTauri({
    currentSourceId: "com.apple.keylayout.German",
    availableSourceIds: ["com.apple.keylayout.German", "com.apple.keylayout.Russian"],
  });
  let currentSourceId = "com.apple.keylayout.German";
  const invoke = tauri.core.invoke;
  tauri.core.invoke = async (command, args) => {
    if (command === "select_macos_input_source") {
      tauri.calls.push([command, args]);
      currentSourceId = args.sourceId;
      return null;
    }
    if (command === "refresh_macos_input_source_sync") {
      tauri.calls.push([command, args]);
      return {
        currentSourceId,
        availableSourceIds: ["com.apple.keylayout.German", "com.apple.keylayout.Russian"],
      };
    }
    return invoke(command, args);
  };
  const seen = [];
  const controller = createMacosInputSourceController({
    tauri,
    onSourceChange: (source) => seen.push(source),
  });
  await controller.start("corney", config);
  assert.equal(await controller.select("com.apple.keylayout.Russian"), true);
  assert.equal(seen.at(-1), "com.apple.keylayout.Russian");
});

test("native selection rejection is propagated without pretending success", async () => {
  const tauri = fakeTauri({
    availableSourceIds: ["com.apple.keylayout.German", "com.apple.keylayout.Russian"],
  });
  const invoke = tauri.core.invoke;
  tauri.core.invoke = async (command, args) => {
    if (command === "select_macos_input_source") throw new Error("selection rejected");
    return invoke(command, args);
  };
  const controller = createMacosInputSourceController({ tauri, onSourceChange() {} });
  await controller.start("corney", config);
  await assert.rejects(controller.select("com.apple.keylayout.Russian"), /selection rejected/);
  assert.equal(controller.getCurrentSourceId(), "com.apple.keylayout.German");
});

test("layout replacement ignores stale notifications and cleans listener", async () => {
  const tauri = fakeTauri();
  const sources = [];
  const controller = createMacosInputSourceController({
    tauri,
    onSourceChange: (source) => sources.push(source),
  });
  await controller.start("first", config);
  const staleListener = tauri.listeners.get("macos_input_source_changed");
  await controller.start("second", config);
  staleListener({ payload: { layout: "first", sourceId: "stale" } });
  assert.equal(sources.includes("stale"), false);
  await controller.stop();
  assert.equal(tauri.listeners.size, 0);
});
