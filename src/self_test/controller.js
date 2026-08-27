import { effectiveLayerEntry, normalizeKeyEntry } from "../layout_catalog.js";
import { normalizeHidDescriptor, normalizeModifier } from "../hid_descriptor.js";

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    position: Object.freeze({ ...entry.position }),
    descriptor: Object.freeze({ ...entry.descriptor, modifiers: Object.freeze([...entry.descriptor.modifiers]) }),
  });
}

export function buildTestPlan({ layoutKey, definition, layers, layerNames, layerIndex = 0, onlyIndexes = null }) {
  const allowed = onlyIndexes ? new Set(onlyIndexes) : null;
  const entries = definition.keyPositions.map((position, index) => {
    const rawEntry = effectiveLayerEntry(layers, layerIndex, index);
    const normalized = normalizeKeyEntry(rawEntry);
    const descriptor = normalizeHidDescriptor(normalized.code);
    return freezeEntry({
      index,
      position,
      label: typeof normalized.label === "object" ? (normalized.label.text ?? "") : (normalized.label ?? ""),
      rawCode: normalized.code ?? "",
      descriptor,
      testable: descriptor.supported && (!allowed || allowed.has(index)),
      excludedFromRetest: Boolean(allowed && !allowed.has(index) && descriptor.supported),
    });
  });
  const testableIndexes = entries.filter((entry) => entry.testable).map((entry) => entry.index);
  return Object.freeze({
    layoutKey,
    layoutName: definition.name ?? layoutKey,
    layerIndex,
    layerName: layerNames?.[layerIndex] ?? `Layer ${layerIndex + 1}`,
    keySize: Object.freeze({ ...definition.keySize }),
    entries: Object.freeze(entries),
    testableIndexes: Object.freeze(testableIndexes),
  });
}

function initialResults(plan) {
  return new Map(plan.entries
    .filter((entry) => !entry.descriptor.supported && !entry.excludedFromRetest)
    .map((entry) => [entry.index, { status: "not-testable", expected: entry.rawCode }]));
}

export function createSelfTestController({ onChange = () => {} } = {}) {
  let state = {
    phase: "setup",
    plan: null,
    cursor: 0,
    results: new Map(),
    pressedCodes: new Set(),
    activeChord: null,
    pendingTransition: null,
    received: null,
    completionRevision: 0,
  };

  function currentEntry() {
    const index = state.plan?.testableIndexes[state.cursor];
    return index === undefined ? null : state.plan.entries[index];
  }

  function snapshot() {
    const results = Object.fromEntries([...state.results.entries()].map(([index, result]) => [index, { ...result }]));
    const counts = { passed: 0, unexpected: 0, skipped: 0, "not-testable": 0 };
    Object.values(results).forEach((result) => { if (result.status in counts) counts[result.status] += 1; });
    const activeModifiers = [...new Set([...state.pressedCodes].map(normalizeModifier).filter(Boolean))];
    return {
      phase: state.phase,
      plan: state.plan,
      cursor: state.cursor,
      current: currentEntry(),
      total: state.plan?.testableIndexes.length ?? 0,
      results,
      counts,
      received: state.received,
      activeModifiers,
      pressedCodes: [...state.pressedCodes],
      chordActive: state.phase === "chord-active",
      waitingForRelease: state.phase === "waiting-clean",
      completionRevision: state.completionRevision,
    };
  }

  function notify() { onChange(snapshot()); }

  function advance() {
    state.cursor += 1;
    state.received = null;
    if (state.cursor >= state.plan.testableIndexes.length) {
      state.phase = "complete";
      state.completionRevision += 1;
    } else {
      state.phase = "waiting-down";
    }
    notify();
  }

  function finishPendingTransition() {
    if (state.phase !== "waiting-clean" || state.pressedCodes.size > 0) return false;
    const transition = state.pendingTransition;
    state.pendingTransition = null;
    if (transition === "advance") {
      advance();
    } else {
      state.phase = "waiting-down";
      state.received = null;
      notify();
    }
    return true;
  }

  function waitForCleanBoundary(transition) {
    state.activeChord = null;
    state.pendingTransition = transition;
    state.received = transition === "retry" ? null : state.received;
    state.phase = "waiting-clean";
    if (!finishPendingTransition()) notify();
  }

  function logicalModifierCodes(excludingCode = null) {
    return [...state.pressedCodes]
      .filter((code) => code !== excludingCode && normalizeModifier(code));
  }

  function modifiersMatchExactly(expectedModifiers, physicalCodes) {
    if (physicalCodes.length !== expectedModifiers.length) return false;
    const logicalModifiers = physicalCodes.map(normalizeModifier);
    return new Set(logicalModifiers).size === expectedModifiers.length
      && expectedModifiers.every((modifier) => logicalModifiers.includes(modifier));
  }

  function start(plan) {
    if (!plan?.testableIndexes.length) return false;
    state = {
      phase: "waiting-clean",
      plan,
      cursor: 0,
      results: initialResults(plan),
      pressedCodes: state.pressedCodes,
      activeChord: null,
      pendingTransition: "start",
      received: null,
      completionRevision: state.completionRevision,
    };
    if (!finishPendingTransition()) notify();
    return true;
  }

  function handleKey(code, eventType) {
    if (!code || !["down", "up"].includes(eventType)) return false;
    const wasPressed = state.pressedCodes.has(code);
    if (eventType === "down") {
      if (wasPressed) return false;
      state.pressedCodes.add(code);
    } else if (!wasPressed) {
      return false;
    } else {
      state.pressedCodes.delete(code);
    }

    if (state.phase === "waiting-clean") {
      if (!finishPendingTransition()) notify();
      return false;
    }
    if (["setup", "complete"].includes(state.phase)) {
      return false;
    }
    if (state.phase === "mismatch") {
      notify();
      return false;
    }

    const expected = currentEntry();
    const modifier = normalizeModifier(code);
    const modifierIsExpectedTrigger = expected?.descriptor.trigger === code
      && expected.descriptor.modifiers.length === 0;

    if (state.phase === "waiting-down") {
      if (eventType === "up") {
        notify();
        return false;
      }
      if (modifier && !modifierIsExpectedTrigger) {
        const sameModifierCodes = logicalModifierCodes().filter((pressed) => normalizeModifier(pressed) === modifier);
        if (expected.descriptor.modifiers.includes(modifier) && sameModifierCodes.length === 1) {
          notify();
          return false;
        }
        state.phase = "mismatch";
        state.received = code;
        notify();
        return true;
      }

      const modifierCodes = logicalModifierCodes(modifierIsExpectedTrigger ? code : null);
      if (code === expected.descriptor.trigger
        && modifiersMatchExactly(expected.descriptor.modifiers, modifierCodes)) {
        state.activeChord = new Set([code, ...modifierCodes]);
        state.phase = "chord-active";
        state.received = code;
      } else {
        state.phase = "mismatch";
        state.received = code;
      }
      notify();
      return true;
    }

    if (state.phase === "chord-active" && eventType === "down") {
      state.phase = "mismatch";
      state.received = code;
      state.activeChord = null;
      notify();
      return true;
    }
    if (state.phase === "chord-active" && eventType === "up") {
      state.activeChord.delete(code);
      if (state.activeChord.size > 0) {
        notify();
        return false;
      }
      state.results.set(expected.index, { status: "passed", expected: expected.rawCode });
      waitForCleanBoundary("advance");
      return true;
    }
    return false;
  }

  function retry() {
    if (state.phase !== "mismatch") return false;
    waitForCleanBoundary("retry");
    return true;
  }

  function markProblem() {
    if (state.phase !== "mismatch") return false;
    const entry = currentEntry();
    state.results.set(entry.index, { status: "unexpected", expected: entry.rawCode, received: state.received });
    waitForCleanBoundary("advance");
    return true;
  }

  function skip() {
    if (!["waiting-down", "chord-active"].includes(state.phase)) return false;
    const entry = currentEntry();
    state.results.set(entry.index, { status: "skipped", expected: entry.rawCode });
    waitForCleanBoundary("advance");
    return true;
  }

  function stop() {
    state = {
      ...state,
      phase: "setup",
      plan: null,
      cursor: 0,
      results: new Map(),
      received: null,
      activeChord: null,
      pendingTransition: null,
    };
    notify();
  }

  function retestProblems() {
    if (state.phase !== "complete" || !state.plan) return false;
    const problems = [...state.results.entries()]
      .filter(([, result]) => result.status === "unexpected" || result.status === "skipped")
      .map(([index]) => index);
    if (!problems.length) return false;
    const plan = Object.freeze({
      ...state.plan,
      testableIndexes: Object.freeze(problems),
      entries: Object.freeze(state.plan.entries.map((entry) => freezeEntry({
        ...entry,
        testable: problems.includes(entry.index),
        excludedFromRetest: entry.descriptor.supported && !problems.includes(entry.index),
      }))),
    });
    return start(plan);
  }

  return { getSnapshot: snapshot, start, handleKey, retry, markProblem, skip, stop, retestProblems, dispose: stop };
}
