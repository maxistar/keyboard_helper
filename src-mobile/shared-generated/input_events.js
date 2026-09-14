/** @typedef {"down" | "up"} KeyAction */
/** @typedef {"ble" | "system"} HighlightingSource */

/**
 * @typedef {Readonly<{
 *   kind: "key",
 *   source: "system",
 *   action: KeyAction,
 *   code: string,
 * }>} SystemKeyInputEvent
 */

/** @typedef {{ source: "ble", sequence: number, streamStart: boolean }} BleEventEnvelope */
/** @typedef {Readonly<BleEventEnvelope & { kind: "key", action: KeyAction, position: number, layer: number }>} BleKeyInputEvent */
/** @typedef {Readonly<BleEventEnvelope & { kind: "combo", action: KeyAction, comboId: number, positions: readonly number[], layer: number }>} BleComboInputEvent */
/** @typedef {Readonly<BleEventEnvelope & { kind: "layer", layer: number, previousLayer: number, cause: number, originPosition: number }>} BleLayerInputEvent */
/** @typedef {Readonly<BleEventEnvelope & { kind: "diagnostic", code: number, severity: number, diagnosticSource: number, count: number, detail: number }>} BleDiagnosticInputEvent */
/** @typedef {BleKeyInputEvent | BleComboInputEvent | BleLayerInputEvent | BleDiagnosticInputEvent} BleInputEvent */
/** @typedef {SystemKeyInputEvent | BleInputEvent} NormalizedInputEvent */

export const HIGHLIGHTING_SOURCES = Object.freeze({
  BLE: "ble",
  SYSTEM: "system",
});

/** @type {ReadonlySet<KeyAction>} */
const VALID_ACTIONS = new Set(["down", "up"]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

/** @param {unknown} value @returns {value is KeyAction} */
function isAction(value) {
  return typeof value === "string" && VALID_ACTIONS.has(/** @type {KeyAction} */ (value));
}

/** @param {unknown} value @returns {value is number} */
function isByte(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xff;
}

/** @param {unknown} value @returns {value is number} */
function isSequence(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/**
 * @param {unknown} payload
 * @returns {SystemKeyInputEvent | null}
 */
export function normalizeSystemKeyEvent(payload) {
  if (!isRecord(payload)) return null;
  const action = payload.event_type ?? payload.action;
  if (typeof payload.key !== "string" || !payload.key || !isAction(action)) return null;
  return Object.freeze({
    kind: "key",
    source: HIGHLIGHTING_SOURCES.SYSTEM,
    action,
    code: payload.key,
  });
}

/**
 * Validate and normalize the decoded, but still untrusted, BLE frame boundary.
 * @param {unknown} frame
 * @returns {BleInputEvent | null}
 */
export function normalizeBleKeyboardFrame(frame) {
  if (!isRecord(frame) || !isRecord(frame.event) || !isSequence(frame.sequence)) return null;
  const event = frame.event;
  if (!Number.isInteger(frame.flags)) return null;
  const common = {
    source: HIGHLIGHTING_SOURCES.BLE,
    sequence: frame.sequence,
    streamStart: Boolean(/** @type {number} */ (frame.flags) & 0x01),
  };

  if (event.kind === "key") {
    if (!isAction(event.action) || !isByte(event.position) || !isByte(event.layer)) return null;
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
      !isAction(event.action)
      || typeof event.comboId !== "number"
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
      positions: Object.freeze(/** @type {number[]} */ ([...positions])),
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
    if (
      typeof event.code !== "number"
      || !Number.isInteger(event.code)
      || !isByte(event.severity)
      || !isByte(event.source)
      || !isSequence(event.count)
      || !isSequence(event.detail)
    ) return null;
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
