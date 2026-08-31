export const SELF_TEST_KEY_STATES = Object.freeze([
  "expected",
  "passed",
  "unexpected",
  "skipped",
  "not-testable",
]);

const STATE_CLASSES = SELF_TEST_KEY_STATES.map((state) => `self-test-${state}`);

export function createOverlayPresentationPayload(snapshot) {
  if (!snapshot?.plan || snapshot.phase === "setup") return { active: false, states: {} };
  const states = {};
  for (const entry of snapshot.plan.entries) {
    if (entry.kind !== "combo" && !entry.testable && !entry.excludedFromRetest) states[entry.index] = "not-testable";
  }
  for (const [index, result] of Object.entries(snapshot.results ?? {})) {
    if (SELF_TEST_KEY_STATES.includes(result.status)) states[index] = result.status;
  }
  if (snapshot.current && snapshot.phase !== "waiting-clean") {
    if (snapshot.current.kind === "combo") {
      for (const position of snapshot.current.positions) states[position] = "expected";
    } else {
      states[snapshot.current.index] = snapshot.phase === "mismatch" ? "unexpected" : "expected";
    }
  }
  return {
    active: true,
    layoutKey: snapshot.plan.layoutKey,
    layerIndex: snapshot.plan.layerIndex,
    states,
  };
}

export function createSelfTestOverlayPresentation({ root, body = root?.ownerDocument?.body } = {}) {
  let current = { active: false, states: {} };

  function keys() {
    return root?.querySelectorAll?.(".key[data-index]") ?? [];
  }

  function clearElement(element) {
    element.classList.remove(...STATE_CLASSES);
    delete element.dataset.selfTestState;
  }

  function render() {
    body?.classList?.toggle("self-test-active", Boolean(current.active));
    for (const element of keys()) {
      clearElement(element);
      if (!current.active) continue;
      const state = current.states?.[element.dataset.index];
      if (!SELF_TEST_KEY_STATES.includes(state)) continue;
      element.classList.add(`self-test-${state}`);
      element.dataset.selfTestState = state;
    }
  }

  function update(payload) {
    current = payload?.active
      ? { ...payload, states: { ...(payload.states ?? {}) } }
      : { active: false, states: {} };
    render();
  }

  function clear() { update(null); }

  return { update, clear, refresh: render, getSnapshot: () => ({ ...current, states: { ...current.states } }) };
}
