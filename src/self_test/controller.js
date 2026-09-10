import { effectiveLayerEntry, normalizeKeyEntry } from "../layout_catalog.js";
import { normalizeHidDescriptor, normalizeModifier } from "../hid_descriptor.js";

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    position: Object.freeze({ ...entry.position }),
    descriptor: Object.freeze({ ...entry.descriptor, modifiers: Object.freeze([...entry.descriptor.modifiers]) }),
  });
}

function positionsForCombo(combo, keyPositions) {
  if (Array.isArray(combo?.positions)) return combo.positions;
  const coordinates = [combo?.key1, combo?.key2];
  if (coordinates.some((position) => !position)) return [];
  return coordinates.map((position) => keyPositions.findIndex(
    (candidate) => candidate.row === position.row && candidate.col === position.col,
  ));
}

function comboEntries(definition, allowed) {
  const entries = [];
  for (const combo of (Array.isArray(definition.combos) ? definition.combos : [])) {
    const code = typeof combo?.code === "string" ? combo.code.trim() : "";
    if (!code) continue;
    const positions = positionsForCombo(combo, definition.keyPositions ?? []);
    const comboId = Number.isInteger(combo?.id) && combo.id > 0 ? combo.id : null;
    if ((!comboId && positions.length === 0)
      || positions.some((position) => !Number.isInteger(position) || position < 0 || position >= definition.keyPositions.length)) {
      continue;
    }
    const index = entries.length;
    const sourceTestable = true;
    entries.push(freezeEntry({
      index,
      kind: "combo",
      position: {},
      label: code,
      rawCode: code,
      descriptor: { supported: false, trigger: null, modifiers: [] },
      comboId,
      positions: Object.freeze([...positions]),
      sourceTestable,
      testable: sourceTestable && (!allowed || allowed.has(index)),
      excludedFromRetest: Boolean(allowed && !allowed.has(index)),
    }));
  }
  return entries;
}

export function buildTestPlan({
  layoutKey,
  definition,
  layers,
  layerNames,
  layerKeys = [],
  layerIndex = 0,
  onlyIndexes = null,
  inputSource = "system",
}) {
  const allowed = onlyIndexes ? new Set(onlyIndexes) : null;
  const entries = definition.keyPositions.map((position, index) => {
    const rawEntry = effectiveLayerEntry(layers, layerIndex, index);
    const normalized = normalizeKeyEntry(rawEntry);
    const descriptor = normalizeHidDescriptor(normalized.code);
    const sourceTestable = descriptor.supported;
    return freezeEntry({
      index,
      kind: "key",
      position,
      label: normalized.label && typeof normalized.label === "object"
        ? (normalized.label.text ?? "")
        : (normalized.label ?? ""),
      rawCode: normalized.code ?? "",
      descriptor,
      sourceTestable,
      testable: sourceTestable && (!allowed || allowed.has(index)),
      excludedFromRetest: Boolean(allowed && !allowed.has(index) && sourceTestable),
    });
  });
  const testableIndexes = entries.filter((entry) => entry.testable).map((entry) => entry.index);
  return Object.freeze({
    planKind: "layer",
    layoutKey,
    layoutName: definition.name ?? layoutKey,
    layerIndex,
    layerKey: layerKeys[layerIndex] ?? String(layerIndex),
    firmwareLayerIndex: layerIndex,
    inputSource,
    layerName: layerNames?.[layerIndex] ?? `Layer ${layerIndex + 1}`,
    keySize: Object.freeze({ ...definition.keySize }),
    entries: Object.freeze(entries),
    testableIndexes: Object.freeze(testableIndexes),
  });
}

export function buildComboTestPlan({ layoutKey, definition, onlyIndexes = null }) {
  const allowed = onlyIndexes ? new Set(onlyIndexes) : null;
  const entries = comboEntries(definition, allowed);
  const testableIndexes = entries.filter((entry) => entry.testable).map((entry) => entry.index);
  return Object.freeze({
    planKind: "global-combos",
    layoutKey,
    layoutName: definition.name ?? layoutKey,
    layerIndex: null,
    layerKey: null,
    firmwareLayerIndex: null,
    inputSource: "ble",
    layerName: "Global firmware combos",
    keySize: Object.freeze({ ...definition.keySize }),
    entries: Object.freeze(entries),
    testableIndexes: Object.freeze(testableIndexes),
  });
}

function initialResults(plan) {
  return new Map(plan.entries
    .filter((entry) => !entry.testable && !entry.excludedFromRetest)
    .map((entry) => [entry.index, { status: "not-testable", expected: entry.rawCode }]));
}

export function createSelfTestController({ onChange = () => {} } = {}) {
  let state = {
    phase: "setup",
    plan: null,
    cursor: 0,
    results: new Map(),
    pressedCodes: new Set(),
    pressedPositions: new Set(),
    activeChord: null,
    activePhysicalPosition: null,
    physicalEvidence: null,
    pendingTransition: null,
    pendingRequiresPhysicalClean: false,
    received: null,
    pauseReason: null,
    completionRevision: 0,
    diagnostics: [],
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
      pauseReason: state.pauseReason,
      activeModifiers,
      pressedCodes: [...state.pressedCodes],
      pressedPositions: [...state.pressedPositions],
      physicalEvidence: state.physicalEvidence ? { ...state.physicalEvidence } : null,
      chordActive: state.phase === "chord-active",
      waitingForRelease: state.phase === "waiting-clean",
      completionRevision: state.completionRevision,
      diagnostics: state.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    };
  }

  function notify() { onChange(snapshot()); }

  function advance() {
    state.cursor += 1;
    state.received = null;
    state.pauseReason = null;
    state.physicalEvidence = null;
    if (state.cursor >= state.plan.testableIndexes.length) {
      state.phase = "complete";
      state.completionRevision += 1;
    } else {
      state.phase = "waiting-down";
    }
    notify();
  }

  function finishPendingTransition() {
    if (state.phase !== "waiting-clean"
      || state.pressedCodes.size > 0
      || (state.pendingRequiresPhysicalClean && state.pressedPositions.size > 0)) return false;
    const transition = state.pendingTransition;
    state.pendingTransition = null;
    state.pendingRequiresPhysicalClean = false;
    if (transition === "advance") {
      advance();
    } else {
      state.phase = "waiting-down";
      state.received = null;
      notify();
    }
    return true;
  }

  function waitForCleanBoundary(transition, { requirePhysical = false } = {}) {
    state.activeChord = null;
    state.activePhysicalPosition = null;
    state.physicalEvidence = null;
    state.pendingTransition = transition;
    state.pendingRequiresPhysicalClean = requirePhysical;
    state.received = ["retry", "resume"].includes(transition) ? null : state.received;
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
      pressedPositions: state.pressedPositions,
      activeChord: null,
      activePhysicalPosition: null,
      physicalEvidence: null,
      pendingTransition: "start",
      pendingRequiresPhysicalClean: false,
      received: null,
      pauseReason: null,
      completionRevision: state.completionRevision,
      diagnostics: state.diagnostics,
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
    if (state.phase === "paused") {
      notify();
      return false;
    }
    if (state.phase === "mismatch") {
      notify();
      return false;
    }

    const expected = currentEntry();
    if (expected?.kind === "combo") {
      notify();
      return false;
    }
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
      state.results.set(expected.index, {
        status: "passed",
        expected: expected.rawCode,
        bleCorroborated: state.physicalEvidence?.position === expected.index
          && state.physicalEvidence?.released === true,
        blePositionWarning: Boolean(state.physicalEvidence?.warning),
      });
      waitForCleanBoundary("advance");
      return true;
    }
    return false;
  }

  function samePositions(left, right) {
    const expected = [...left].sort((a, b) => a - b);
    const received = [...right].sort((a, b) => a - b);
    return left.length === right.length
      && expected.every((position, index) => position === received[index]);
  }

  function recordDiagnostic(code, detail = {}) {
    state.diagnostics = [...state.diagnostics, { code, ...detail }].slice(-20);
  }

  function reportDiagnostic(code, detail = {}) {
    recordDiagnostic(code, detail);
    notify();
  }

  function handleSourceTransition(previous, current, reason = null) {
    if (previous === current) return false;
    if (previous === "ble") {
      state.pressedPositions.clear();
      state.activePhysicalPosition = null;
      state.physicalEvidence = null;
    }
    recordDiagnostic(current === "ble" ? "ble-source-active" : "ble-fallback", {
      message: `${previous} → ${current}${reason ? `: ${reason}` : ""}`,
    });
    if (state.phase === "waiting-clean") {
      if (!finishPendingTransition()) notify();
      return true;
    }
    notify();
    return true;
  }

  function handlePhysicalKey(position, eventType) {
    if (!Number.isInteger(position) || position < 0 || !["down", "up"].includes(eventType)) return false;
    const wasPressed = state.pressedPositions.has(position);
    if (eventType === "down") {
      if (wasPressed) return false;
      state.pressedPositions.add(position);
    } else if (!wasPressed) {
      return false;
    } else {
      state.pressedPositions.delete(position);
    }

    if (state.phase === "waiting-clean") {
      if (!finishPendingTransition()) notify();
      return false;
    }
    if (["setup", "complete"].includes(state.phase)) return false;
    if (state.phase === "paused") {
      notify();
      return false;
    }
    if (state.phase === "mismatch") {
      notify();
      return false;
    }

    const expected = currentEntry();
    if (expected?.kind === "combo") {
      if (!expected.positions.includes(position)) {
        recordDiagnostic("unexpected-ble-key", { position });
        state.phase = "mismatch";
        state.received = `Position ${position}`;
        notify();
        return true;
      }
      notify();
      return false;
    }

    if (eventType === "down" && position !== expected?.index) {
      recordDiagnostic("unexpected-ble-key", { position, expectedPosition: expected?.index });
      state.physicalEvidence = { position, warning: true, released: false };
      notify();
      return true;
    }
    if (eventType === "down" && position === expected?.index) {
      state.physicalEvidence = { position, warning: false, released: false };
      notify();
      return true;
    }
    if (eventType === "up" && position === state.physicalEvidence?.position) {
      state.physicalEvidence = { ...state.physicalEvidence, released: true };
    }
    notify();
    return false;
  }

  function handleCombo(comboId, positions, eventType) {
    if (eventType !== "down" || !Array.isArray(positions)) return false;
    const expected = currentEntry();
    const matches = expected?.kind === "combo"
      && ((expected.comboId && expected.comboId === comboId) || samePositions(expected.positions, positions));
    if (!matches) {
      reportDiagnostic("unmatched-ble-combo", { comboId, positions: [...positions] });
      return false;
    }
    state.results.set(expected.index, { status: "passed", expected: expected.rawCode });
    state.received = comboId ? `Combo ${comboId}` : `Positions ${positions.join("+")}`;
    waitForCleanBoundary("advance", { requirePhysical: true });
    return true;
  }

  function retry() {
    if (state.phase !== "mismatch") return false;
    waitForCleanBoundary("retry");
    return true;
  }

  function pause(reason = "The active keyboard layer changed") {
    if (["setup", "complete", "paused"].includes(state.phase)) return false;
    state.phase = "paused";
    state.pauseReason = reason;
    state.activeChord = null;
    state.activePhysicalPosition = null;
    state.physicalEvidence = null;
    state.pendingTransition = null;
    state.pendingRequiresPhysicalClean = false;
    state.received = null;
    notify();
    return true;
  }

  function resume() {
    if (state.phase !== "paused") return false;
    state.pauseReason = null;
    waitForCleanBoundary("resume");
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
      pauseReason: null,
      activeChord: null,
      activePhysicalPosition: null,
      physicalEvidence: null,
      pendingTransition: null,
      pendingRequiresPhysicalClean: false,
      pressedPositions: new Set(),
      diagnostics: [],
    };
    notify();
  }

  function createRetestPlan() {
    if (state.phase !== "complete" || !state.plan) return false;
    const problems = [...state.results.entries()]
      .filter(([, result]) => result.status === "unexpected" || result.status === "skipped")
      .map(([index]) => index);
    if (!problems.length) return false;
    return Object.freeze({
      ...state.plan,
      testableIndexes: Object.freeze(problems),
      entries: Object.freeze(state.plan.entries.map((entry) => freezeEntry({
        ...entry,
        testable: problems.includes(entry.index),
        excludedFromRetest: entry.sourceTestable && !problems.includes(entry.index),
      }))),
    });
  }

  function retestProblems() {
    const plan = createRetestPlan();
    if (!plan) return false;
    return start(plan);
  }

  return {
    getSnapshot: snapshot,
    start,
    handleKey,
    handlePhysicalKey,
    handleCombo,
    reportDiagnostic,
    handleSourceTransition,
    retry,
    pause,
    resume,
    markProblem,
    skip,
    stop,
    createRetestPlan,
    retestProblems,
    dispose: stop,
  };
}
