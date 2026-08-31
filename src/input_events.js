export const HIGHLIGHTING_SOURCES = Object.freeze({
  BLE: "ble",
  SYSTEM: "system",
});

export const HIGHLIGHTING_POLICIES = Object.freeze({
  AUTO: "auto",
  BLE: "ble",
  SYSTEM: "system",
});

const VALID_ACTIONS = new Set(["down", "up"]);

function isByte(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xff;
}

function isSequence(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

export function normalizeHighlightingPolicy(value) {
  return Object.values(HIGHLIGHTING_POLICIES).includes(value)
    ? value
    : HIGHLIGHTING_POLICIES.AUTO;
}

export function normalizeSystemKeyEvent(payload) {
  const action = payload?.event_type ?? payload?.action;
  if (typeof payload?.key !== "string" || !payload.key || !VALID_ACTIONS.has(action)) return null;
  return Object.freeze({
    kind: "key",
    source: HIGHLIGHTING_SOURCES.SYSTEM,
    action,
    code: payload.key,
  });
}

export function normalizeBleKeyboardFrame(frame) {
  const event = frame?.event;
  if (!event || !isSequence(frame.sequence)) return null;
  const common = {
    source: HIGHLIGHTING_SOURCES.BLE,
    sequence: frame.sequence,
    streamStart: Boolean(frame.flags & 0x01),
  };

  if (event.kind === "key") {
    if (!VALID_ACTIONS.has(event.action) || !isByte(event.position) || !isByte(event.layer)) return null;
    return Object.freeze({
      ...common,
      kind: "key",
      action: event.action,
      position: event.position,
      layer: event.layer,
    });
  }

  if (event.kind === "combo") {
    const positions = event.positions;
    if (
      !VALID_ACTIONS.has(event.action)
      || !Number.isInteger(event.comboId)
      || event.comboId <= 0
      || event.comboId > 0xffff
      || !isByte(event.layer)
      || !Array.isArray(positions)
      || positions.length > 4
      || positions.some((position) => !isByte(position))
    ) return null;
    return Object.freeze({
      ...common,
      kind: "combo",
      action: event.action,
      comboId: event.comboId,
      positions: Object.freeze([...positions]),
      layer: event.layer,
    });
  }

  if (event.kind === "layer") {
    if (
      !isByte(event.layer)
      || !isByte(event.previousLayer)
      || !isByte(event.cause)
      || !isByte(event.originPosition)
    ) return null;
    return Object.freeze({
      ...common,
      kind: "layer",
      layer: event.layer,
      previousLayer: event.previousLayer,
      cause: event.cause,
      originPosition: event.originPosition,
    });
  }

  if (event.kind === "diagnostic") {
    if (!Number.isInteger(event.code) || !isByte(event.severity) || !isByte(event.source)) return null;
    return Object.freeze({
      ...common,
      kind: "diagnostic",
      code: event.code,
      severity: event.severity,
      diagnosticSource: event.source,
      count: event.count,
      detail: event.detail,
    });
  }

  return null;
}
