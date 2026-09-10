import { normalizeBleKeyboardFrame } from "./input_events.js";

export const BLE_KEYBOARD_UUIDS = Object.freeze({
  service: "b34a0001-e782-4706-8f9c-6c056c416507",
  layer: "b34a0002-e782-4706-8f9c-6c056c416507",
  capabilities: "b34a0003-e782-4706-8f9c-6c056c416507",
  events: "b34a0004-e782-4706-8f9c-6c056c416507",
});

export const BLE_KEYBOARD_PROTOCOL = Object.freeze({
  major: 1,
  capabilitiesLength: 8,
  frameHeaderLength: 8,
  maximumFrameLength: 20,
  maximumComboPositions: 4,
  positionSchema: 1,
});

export const BLE_KEYBOARD_CAPABILITY_FLAGS = Object.freeze({
  keyEvents: 1 << 0,
  comboEvents: 1 << 1,
  layerEvents: 1 << 2,
  diagnostics: 1 << 4,
  legacyLayerRegister: 1 << 5,
  legacyLayerWrite: 1 << 6,
});

export const BLE_KEYBOARD_FRAME_FLAGS = Object.freeze({
  streamStart: 1 << 0,
  snapshot: 1 << 1,
  gapReport: 1 << 2,
});

export const BLE_KEYBOARD_EVENT_TYPES = Object.freeze({
  key: 0x01,
  combo: 0x02,
  layer: 0x03,
  reserved: 0x04,
  diagnostic: 0x05,
});

export const DECODER_OUTCOME = Object.freeze({
  decoded: "decoded",
  skipped: "skipped",
  rejected: "rejected",
});

const KNOWN_FRAME_FLAGS = Object.values(BLE_KEYBOARD_FRAME_FLAGS)
  .reduce((mask, flag) => mask | flag, 0);

function immutable(value) {
  if (Array.isArray(value)) {
    value.forEach(immutable);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
  }
  return Object.freeze(value);
}

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff)) {
    return Uint8Array.from(value);
  }
  return null;
}

function decoded(value, envelope = undefined) {
  return immutable({ status: DECODER_OUTCOME.decoded, value, ...(envelope ? { envelope } : {}) });
}

function skipped(reason, envelope) {
  return immutable({ status: DECODER_OUTCOME.skipped, reason, envelope });
}

function rejected(code, detail = {}) {
  return immutable({ status: DECODER_OUTCOME.rejected, issue: { code, ...detail } });
}

function readUint16(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32(data, offset) {
  return (data[offset]
    | (data[offset + 1] << 8)
    | (data[offset + 2] << 16)
    | (data[offset + 3] << 24)) >>> 0;
}

function action(value) {
  if (value === 0) return "up";
  if (value === 1) return "down";
  return null;
}

export function decodeBleKeyboardCapabilities(value) {
  const data = bytes(value);
  if (!data) return rejected("invalid-byte-input");
  if (data.length !== BLE_KEYBOARD_PROTOCOL.capabilitiesLength) {
    return rejected("invalid-capabilities-length", { actualLength: data.length });
  }
  if (data[0] !== BLE_KEYBOARD_PROTOCOL.major) {
    return rejected("unsupported-protocol-major", { protocolMajor: data[0] });
  }
  if (
    data[4] < BLE_KEYBOARD_PROTOCOL.frameHeaderLength
    || data[4] > BLE_KEYBOARD_PROTOCOL.maximumFrameLength
    || data[5] !== BLE_KEYBOARD_PROTOCOL.positionSchema
    || data[6] !== 0
    || data[7] !== 0
  ) {
    return rejected("invalid-capabilities-bounds");
  }

  const flags = readUint16(data, 2);
  return decoded({
    protocolMajor: data[0],
    protocolMinor: data[1],
    maxFrameLength: data[4],
    positionSchema: data[5],
    features: {
      keyEvents: Boolean(flags & BLE_KEYBOARD_CAPABILITY_FLAGS.keyEvents),
      comboEvents: Boolean(flags & BLE_KEYBOARD_CAPABILITY_FLAGS.comboEvents),
      layerEvents: Boolean(flags & BLE_KEYBOARD_CAPABILITY_FLAGS.layerEvents),
      diagnostics: Boolean(flags & BLE_KEYBOARD_CAPABILITY_FLAGS.diagnostics),
      legacyLayerRegister: Boolean(flags & BLE_KEYBOARD_CAPABILITY_FLAGS.legacyLayerRegister),
      legacyLayerWrite: Boolean(flags & BLE_KEYBOARD_CAPABILITY_FLAGS.legacyLayerWrite),
    },
  });
}

function decodeKnownEvent(eventType, payload) {
  if (eventType === BLE_KEYBOARD_EVENT_TYPES.key) {
    if (payload.length !== 3) return rejected("invalid-key-payload-length", { actualLength: payload.length });
    const eventAction = action(payload[0]);
    if (!eventAction) return rejected("invalid-action", { action: payload[0] });
    return { kind: "key", action: eventAction, position: payload[1], layer: payload[2] };
  }

  if (eventType === BLE_KEYBOARD_EVENT_TYPES.combo) {
    if (payload.length < 5 || payload.length > 9) {
      return rejected("invalid-combo-payload-length", { actualLength: payload.length });
    }
    const comboId = readUint16(payload, 0);
    const eventAction = action(payload[2]);
    const count = payload[4];
    if (!eventAction) return rejected("invalid-action", { action: payload[2] });
    if (comboId === 0 || count > BLE_KEYBOARD_PROTOCOL.maximumComboPositions || payload.length !== 5 + count) {
      return rejected("invalid-combo");
    }
    return {
      kind: "combo",
      comboId,
      action: eventAction,
      layer: payload[3],
      positions: [...payload.slice(5)],
    };
  }

  if (eventType === BLE_KEYBOARD_EVENT_TYPES.layer) {
    if (payload.length !== 4) return rejected("invalid-layer-payload-length", { actualLength: payload.length });
    if (payload[2] > 3) return rejected("invalid-layer-cause", { cause: payload[2] });
    return {
      kind: "layer",
      layer: payload[0],
      previousLayer: payload[1],
      cause: payload[2],
      originPosition: payload[3],
    };
  }

  if (eventType === BLE_KEYBOARD_EVENT_TYPES.diagnostic) {
    if (payload.length !== 12) return rejected("invalid-diagnostic-payload-length", { actualLength: payload.length });
    if (payload[2] > 2) return rejected("invalid-diagnostic-severity", { severity: payload[2] });
    return {
      kind: "diagnostic",
      code: readUint16(payload, 0),
      severity: payload[2],
      source: payload[3],
      count: readUint32(payload, 4),
      detail: readUint32(payload, 8),
    };
  }

  return null;
}

export function decodeBleKeyboardFrame(value, capabilities) {
  const data = bytes(value);
  if (!data) return rejected("invalid-byte-input");
  if (data.length < BLE_KEYBOARD_PROTOCOL.frameHeaderLength) {
    return rejected("invalid-frame-length", { actualLength: data.length });
  }

  const advertisedMaximum = capabilities?.maxFrameLength ?? BLE_KEYBOARD_PROTOCOL.maximumFrameLength;
  if (
    !Number.isInteger(advertisedMaximum)
    || advertisedMaximum < BLE_KEYBOARD_PROTOCOL.frameHeaderLength
    || advertisedMaximum > BLE_KEYBOARD_PROTOCOL.maximumFrameLength
    || data.length > advertisedMaximum
  ) {
    return rejected("invalid-frame-length", { actualLength: data.length });
  }
  if (data[0] !== BLE_KEYBOARD_PROTOCOL.major) {
    return rejected("unsupported-protocol-major", { protocolMajor: data[0] });
  }
  if (data[2] & ~KNOWN_FRAME_FLAGS) return rejected("invalid-frame-flags", { flags: data[2] });

  const eventType = data[1];
  const flags = data[2];
  const payloadLength = data[3];
  const sequence = readUint32(data, 4);
  if (data.length !== BLE_KEYBOARD_PROTOCOL.frameHeaderLength + payloadLength) {
    return rejected("invalid-payload-length", { eventType, declaredLength: payloadLength, actualLength: data.length - 8 });
  }

  const envelope = { eventType, flags, sequence };
  if (eventType === BLE_KEYBOARD_EVENT_TYPES.reserved) return skipped("reserved-event-type", envelope);

  const event = decodeKnownEvent(eventType, data.slice(BLE_KEYBOARD_PROTOCOL.frameHeaderLength));
  if (event === null) return skipped("unknown-event-type", envelope);
  if (event.status === DECODER_OUTCOME.rejected) return event;

  const frame = { sequence, flags, event };
  const normalized = normalizeBleKeyboardFrame(frame);
  return normalized ? decoded(normalized, envelope) : rejected("invalid-normalized-event");
}
