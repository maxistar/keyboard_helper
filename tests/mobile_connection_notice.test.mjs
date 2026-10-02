import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectionIndicator,
  connectionIndicatorState,
  connectionNoticeText,
  createConnectionNoticeController,
} from "../src-mobile/connection_notice.js";

function clock() {
  let now = 0;
  let nextId = 1;
  const queue = new Map();
  return {
    schedule(callback, ms) { const id = nextId++; queue.set(id, { callback, at: now + ms }); return id; },
    cancel(id) { queue.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, item] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (item.at <= now && queue.delete(id)) item.callback();
      }
    },
  };
}

function subject() {
  const timers = clock();
  const shown = [];
  const controller = createConnectionNoticeController({
    render: (text, kind) => shown.push([text, kind]),
    schedule: timers.schedule,
    cancel: timers.cancel,
    settleMs: 100,
    displayMs: 1000,
  });
  return { controller, shown, timers };
}

const ready = { phase: "ready", selectedDevice: { name: "Corne" } };
const lost = { phase: "disconnected", selectedDevice: { name: "Corne" } };
const reconnecting = { phase: "reconnecting", selectedDevice: { name: "Corne" } };

test("indicator state maps severity to distinct states and defaults to neutral", () => {
  assert.equal(connectionIndicatorState({ severity: "success" }), ConnectionIndicator.READY);
  assert.equal(connectionIndicatorState({ severity: "progress" }), ConnectionIndicator.PROGRESS);
  assert.equal(connectionIndicatorState({ severity: "attention" }), ConnectionIndicator.ATTENTION);
  assert.equal(connectionIndicatorState({ severity: "error" }), ConnectionIndicator.PROBLEM);
  assert.equal(connectionIndicatorState({ severity: "neutral" }), ConnectionIndicator.NEUTRAL);
  assert.equal(connectionIndicatorState(null), ConnectionIndicator.NEUTRAL);
});

test("notice text names the keyboard and includes battery only when known", () => {
  assert.equal(connectionNoticeText("ready", "Corne", "81%"), "Keyboard connected · Corne · 81%");
  assert.equal(connectionNoticeText("ready", "Corne", ""), "Keyboard connected · Corne");
  assert.equal(connectionNoticeText("ready", "", ""), "Keyboard connected");
  assert.equal(connectionNoticeText("lost", "Corne", "81%"), "Keyboard disconnected · Corne");
});

test("a ready notice is emitted after the settle window and hides after the display time", () => {
  const { controller, shown, timers } = subject();
  controller.observe(ready);
  assert.deepEqual(shown, []);
  timers.advance(100);
  assert.deepEqual(shown, [["Keyboard connected · Corne", "ready"]]);
  timers.advance(1000);
  assert.deepEqual(shown.at(-1), [null, null]);
});

test("a loss is only reported after a shown ready notice", () => {
  const { controller, shown, timers } = subject();
  controller.observe(lost);
  timers.advance(100);
  assert.deepEqual(shown, [], "no keyboard was ever announced, so its absence is not news");
  controller.observe(ready);
  timers.advance(100);
  timers.advance(1000);
  controller.observe(lost);
  timers.advance(100);
  assert.equal(shown.at(-1)[0], "Keyboard disconnected · Corne");
});

test("rapid flapping collapses to the final state without a visible flash", () => {
  const { controller, shown, timers } = subject();
  controller.observe(ready);
  timers.advance(100);
  timers.advance(1000);
  const before = shown.length;
  controller.observe(lost);
  timers.advance(30);
  controller.observe(ready);
  timers.advance(100);
  assert.equal(shown.length, before, "ready, lost, ready inside the window shows nothing new");
});

test("an in-progress phase cancels a pending notice and repeated ready does not repeat it", () => {
  const { controller, shown, timers } = subject();
  controller.observe(ready);
  timers.advance(100);
  timers.advance(1000);
  const before = shown.length;
  controller.observe(lost);
  controller.observe(reconnecting);
  timers.advance(500);
  controller.observe(ready);
  timers.advance(100);
  assert.equal(shown.length, before);
  controller.observe(ready);
  timers.advance(100);
  assert.equal(shown.length, before);
});

test("battery evidence updates a visible ready notice and dispose cancels timers", () => {
  const { controller, shown, timers } = subject();
  controller.observe(ready);
  timers.advance(100);
  controller.setBattery("55%");
  assert.equal(shown.at(-1)[0], "Keyboard connected · Corne · 55%");
  controller.dispose();
  timers.advance(5000);
  assert.notEqual(shown.at(-1)[0], null, "disposed controller schedules nothing further");
  assert.throws(() => createConnectionNoticeController({}), TypeError);
});
