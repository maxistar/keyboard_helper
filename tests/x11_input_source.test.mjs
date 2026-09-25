import assert from "node:assert/strict";
import test from "node:test";

import { createX11InputSourceController } from "../src/x11_input_source.js";

const diagnostics = {
  sessionType: "x11",
  display: ":0",
  followsXkbOnly: true,
  groups: [
    {
      groupIndex: 0,
      groupName: "German",
      layout: "de",
      variant: null,
      identifiers: ["xkb:layout:de", "xkb:group:0"],
    },
    {
      groupIndex: 1,
      groupName: "Russian",
      layout: "ru",
      variant: null,
      identifiers: ["xkb:layout:ru", "xkb:group:1"],
    },
  ],
};

const config = {
  sources: [
    { inputSourceId: "xkb:layout:de" },
    { inputSourceId: "xkb:layout:ru" },
  ],
};

function fakeTauri({ startupError = null, confirmedSelection = true } = {}) {
  const listeners = new Map();
  const calls = [];
  let currentSourceId = "xkb:layout:de";
  return {
    calls,
    listeners,
    core: {
      async invoke(command, args) {
        calls.push([command, args]);
        if (command === "start_x11_input_source_sync") {
          if (startupError) throw startupError;
          return {
            currentSourceId,
            availableSourceIds: ["xkb:layout:de", "xkb:layout:ru"],
            diagnostics,
          };
        }
        if (command === "select_x11_input_source" && confirmedSelection) {
          currentSourceId = args.sourceId;
        }
        if (command === "refresh_x11_input_source_sync") {
          return {
            currentSourceId,
            availableSourceIds: ["xkb:layout:de", "xkb:layout:ru"],
            diagnostics,
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

test("publishes confirmed bootstrap source, availability, and structured diagnostics", async () => {
  const tauri = fakeTauri();
  const sources = [];
  const availability = [];
  const seenDiagnostics = [];
  const controller = createX11InputSourceController({
    tauri,
    onSourceChange: (source) => sources.push(source),
    onAvailabilityChange: (ids) => availability.push([...ids]),
    onDiagnosticsChange: (value) => seenDiagnostics.push(value),
  });

  assert.equal(controller.getStatus().supported, true);
  assert.equal(controller.getStatus().available, false);
  assert.equal(await controller.start("corney", config), true);
  assert.equal(controller.getStatus().available, true);
  assert.deepEqual(sources, ["xkb:layout:de"]);
  assert.deepEqual(availability.at(-1), ["xkb:layout:de", "xkb:layout:ru"]);
  assert.deepEqual(seenDiagnostics.at(-1), diagnostics);
  assert.deepEqual(controller.getDiagnostics(), diagnostics);
});

test("preserves machine-readable failed-start availability status", async () => {
  const tauri = fakeTauri({
    startupError: {
      reason: "wayland-session",
      message: "X11 sync is unavailable under Wayland",
      diagnostics: null,
    },
  });
  const errors = [];
  const sources = [];
  const controller = createX11InputSourceController({
    tauri,
    onSourceChange: (source) => sources.push(source),
    onError: (error) => errors.push(error),
  });

  assert.equal(await controller.start("corney", config), false);
  assert.deepEqual(sources, []);
  assert.equal(controller.getStatus().supported, true);
  assert.equal(controller.getStatus().available, false);
  assert.equal(controller.getStatus().reason, "wayland-session");
  assert.match(controller.getStatus().message, /Wayland/);
  assert.equal(errors.length, 1);
});

test("ignores stale layout events and cleans the listener on stop", async () => {
  const tauri = fakeTauri();
  const sources = [];
  const controller = createX11InputSourceController({
    tauri,
    onSourceChange: (source) => sources.push(source),
  });
  await controller.start("first", config);
  const staleListener = tauri.listeners.get("x11_input_source_changed");
  await controller.start("second", config);
  staleListener({
    payload: {
      layout: "first",
      sourceId: "xkb:layout:ru",
      availableSourceIds: ["xkb:layout:ru"],
      diagnostics,
    },
  });
  assert.equal(sources.at(-1), "xkb:layout:de");
  await controller.stop();
  assert.equal(tauri.listeners.size, 0);
});

test("selection succeeds only after native read-back confirms the group", async () => {
  const tauri = fakeTauri();
  const controller = createX11InputSourceController({ tauri, onSourceChange() {} });
  await controller.start("corney", config);
  assert.equal(await controller.select("xkb:layout:ru"), true);
  assert.equal(controller.getCurrentSourceId(), "xkb:layout:ru");
});

test("selection mismatch does not publish the requested source", async () => {
  const tauri = fakeTauri({ confirmedSelection: false });
  const sources = [];
  const controller = createX11InputSourceController({
    tauri,
    onSourceChange: (source) => sources.push(source),
  });
  await controller.start("corney", config);
  await assert.rejects(controller.select("xkb:layout:ru"), /did not confirm/);
  assert.equal(controller.getCurrentSourceId(), "xkb:layout:de");
  assert.equal(sources.includes("xkb:layout:ru"), false);
});

test("unavailable configured source is rejected before a native selection call", async () => {
  const tauri = fakeTauri();
  const controller = createX11InputSourceController({ tauri, onSourceChange() {} });
  await controller.start("corney", config);
  await assert.rejects(controller.select("xkb:layout:us"), /unavailable/);
  assert.equal(
    tauri.calls.some(([command, args]) => command === "select_x11_input_source" && args.sourceId === "xkb:layout:us"),
    false,
  );
});
