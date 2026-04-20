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
  const toggleButton = new EventTargetStub();
  toggleButton.dataset = {};
  toggleButton.title = "";
  toggleButton.textContent = "";

  const document = new EventTargetStub();
  document.getElementById = (id) => (id === "windowless" ? toggleButton : null);

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

  return { document, invokeCalls, tauri, toggleButton, window };
}

const flushAsyncWork = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

test("document click restores visible mode when currently windowless", async () => {
  const { document, invokeCalls, tauri, toggleButton, window } = createEnvironment();
  window.setupWindowModeToggle(tauri);

  const toggleClickEvent = {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  toggleButton.trigger("click", toggleClickEvent);
  await flushAsyncWork();

  assert.equal(toggleClickEvent.defaultPrevented, true);
  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].command, "set_window_decorations");
  assert.equal(invokeCalls[0].payload.decorations, false);

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
});

test("document click is ignored while window is already visible", async () => {
  const { document, invokeCalls, tauri, window } = createEnvironment();
  window.setupWindowModeToggle(tauri);

  document.trigger("click", {});
  await flushAsyncWork();

  assert.equal(invokeCalls.length, 0);
});
