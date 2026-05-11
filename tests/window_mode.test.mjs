import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    const entry = {
      listener,
      once: Boolean(options?.once),
    };
    this.listeners.get(type).push(entry);

    if (options?.signal) {
      options.signal.addEventListener(
        "abort",
        () => {
          this.removeEventListener(type, listener);
        },
        { once: true },
      );
    }
  }

  removeEventListener(type, listener) {
    const entries = this.listeners.get(type);
    if (!entries) return;
    this.listeners.set(
      type,
      entries.filter((entry) => entry.listener !== listener),
    );
  }

  trigger(type, event = {}) {
    const entries = [...(this.listeners.get(type) ?? [])];
    for (const entry of entries) {
      entry.listener(event);
      if (entry.once) {
        this.removeEventListener(type, entry.listener);
      }
    }
  }
}

function createEnvironment() {
  const invokeCalls = [];

  const document = new EventTargetStub();
  document.getElementById = () => null;
  document.body = {
    classList: {
      values: new Set(),
      add(name) {
        this.values.add(name);
      },
      toggle(name, force) {
        if (force === undefined) {
          if (this.values.has(name)) {
            this.values.delete(name);
            return false;
          }
          this.values.add(name);
          return true;
        }
        if (force) {
          this.values.add(name);
          return true;
        }
        this.values.delete(name);
        return false;
      },
    },
  };

  const window = new EventTargetStub();
  window.document = document;

  const timers = new Map();
  let nextTimerId = 1;
  const setTimeoutStub = (fn, ms) => {
    const id = nextTimerId++;
    timers.set(id, { fn, ms });
    return id;
  };
  const clearTimeoutStub = (id) => {
    timers.delete(id);
  };

  const tauri = {
    core: {
      invoke: async (command, payload) => {
        invokeCalls.push({ command, payload });
      },
    },
  };

  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/window_mode.js",
  );
  const source = fs.readFileSync(sourcePath, "utf8");

  const context = vm.createContext({
    AbortController,
    clearTimeout: clearTimeoutStub,
    console,
    document,
    setTimeout: setTimeoutStub,
    window,
  });
  vm.runInContext(source, context, { filename: "window_mode.js" });

  return { document, invokeCalls, tauri, timers, window };
}

const flushAsyncWork = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

test("auto-hide hides chrome after inactivity and document click restores it", async () => {
  const { document, invokeCalls, tauri, timers, window } = createEnvironment();
  window.setupWindowModeToggle(tauri);

  assert.equal(invokeCalls.length, 0);
  assert.equal(timers.size, 1);

  const [{ fn, ms }] = [...timers.values()];
  assert.equal(ms, 30_000);
  fn();
  await flushAsyncWork();

  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].command, "set_window_decorations");
  assert.equal(invokeCalls[0].payload.decorations, false);
  assert.equal(timers.size, 0);

  const documentClickEvent = {
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  document.trigger("click", documentClickEvent);
  await flushAsyncWork();

  assert.equal(invokeCalls.length, 2);
  assert.equal(invokeCalls[1].command, "set_window_decorations");
  assert.equal(invokeCalls[1].payload.decorations, true);
  assert.equal(documentClickEvent.prevented, false);
  assert.equal(documentClickEvent.stopped, false);
  assert.equal(timers.size, 1);
});

test("document click is ignored while window is already visible", async () => {
  const { document, invokeCalls, tauri, window } = createEnvironment();
  window.setupWindowModeToggle(tauri);

  document.trigger("click", {});
  await flushAsyncWork();

  assert.equal(invokeCalls.length, 0);
});
