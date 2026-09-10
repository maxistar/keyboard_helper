use std::fmt;

use serde::Serialize;

const PROTOCOL_MAJOR: u8 = 1;
const CAPABILITIES_LENGTH: usize = 8;
const FRAME_HEADER_LENGTH: usize = 8;
const MAX_FRAME_LENGTH: usize = 20;
const MAX_COMBO_POSITIONS: usize = 4;
const POSITION_SCHEMA: u8 = 1;
const RESERVED_CAPABILITY_BIT: u16 = 1 << 3;
const KNOWN_FRAME_FLAGS: u8 = 0x07;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BleKeyboardCapabilities {
    pub protocol_major: u8,
    pub protocol_minor: u8,
    pub flags: u16,
    pub max_frame_length: u8,
    pub position_schema: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InputAction {
    Up,
    Down,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BleKeyboardEvent {
    Key {
        action: InputAction,
        position: u8,
        layer: u8,
    },
    Combo {
        action: InputAction,
        combo_id: u16,
        positions: Vec<u8>,
        layer: u8,
    },
    Layer {
        layer: u8,
        previous_layer: u8,
        cause: u8,
        origin_position: u8,
    },
    Diagnostic {
        code: u16,
        severity: u8,
        source: u8,
        count: u32,
        detail: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedBleKeyboardFrame {
    pub sequence: u32,
    pub flags: u8,
    pub event: BleKeyboardEvent,
}

impl DecodedBleKeyboardFrame {
    pub fn stream_start(&self) -> bool {
        self.flags & 0x01 != 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecodeError {
    InvalidCapabilitiesLength(usize),
    InvalidFrameLength(usize),
    UnsupportedProtocolMajor(u8),
    ReservedCapabilitySet,
    InvalidCapabilities,
    InvalidFlags(u8),
    UnsupportedEventType(u8),
    InvalidPayloadLength { event_type: u8, actual: usize },
    InvalidAction(u8),
    InvalidCombo,
    InvalidLayerCause(u8),
    InvalidDiagnosticSeverity(u8),
}

impl fmt::Display for DecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for DecodeError {}

pub fn decode_capabilities(data: &[u8]) -> Result<BleKeyboardCapabilities, DecodeError> {
    if data.len() != CAPABILITIES_LENGTH {
        return Err(DecodeError::InvalidCapabilitiesLength(data.len()));
    }
    if data[0] != PROTOCOL_MAJOR {
        return Err(DecodeError::UnsupportedProtocolMajor(data[0]));
    }

    let flags = u16::from_le_bytes([data[2], data[3]]);
    if flags & RESERVED_CAPABILITY_BIT != 0 {
        return Err(DecodeError::ReservedCapabilitySet);
    }
    if data[4] < FRAME_HEADER_LENGTH as u8
        || data[4] > MAX_FRAME_LENGTH as u8
        || data[5] != POSITION_SCHEMA
        || data[6] != 0
        || data[7] != 0
    {
        return Err(DecodeError::InvalidCapabilities);
    }

    Ok(BleKeyboardCapabilities {
        protocol_major: data[0],
        protocol_minor: data[1],
        flags,
        max_frame_length: data[4],
        position_schema: data[5],
    })
}

pub fn decode_frame(data: &[u8]) -> Result<DecodedBleKeyboardFrame, DecodeError> {
    if data.len() < FRAME_HEADER_LENGTH || data.len() > MAX_FRAME_LENGTH {
        return Err(DecodeError::InvalidFrameLength(data.len()));
    }
    if data[0] != PROTOCOL_MAJOR {
        return Err(DecodeError::UnsupportedProtocolMajor(data[0]));
    }
    if data[2] & !KNOWN_FRAME_FLAGS != 0 {
        return Err(DecodeError::InvalidFlags(data[2]));
    }

    let event_type = data[1];
    let payload_length = data[3] as usize;
    if data.len() != FRAME_HEADER_LENGTH + payload_length {
        return Err(DecodeError::InvalidPayloadLength {
            event_type,
            actual: payload_length,
        });
    }

    let sequence = read_u32(&data[4..8]);
    let payload = &data[FRAME_HEADER_LENGTH..];
    let event = match event_type {
        0x01 => decode_key(payload)?,
        0x02 => decode_combo(payload)?,
        0x03 => decode_layer(payload)?,
        0x04 => return Err(DecodeError::UnsupportedEventType(event_type)),
        0x05 => decode_diagnostic(payload)?,
        _ => return Err(DecodeError::UnsupportedEventType(event_type)),
    };

    Ok(DecodedBleKeyboardFrame {
        sequence,
        flags: data[2],
        event,
    })
}

fn decode_key(payload: &[u8]) -> Result<BleKeyboardEvent, DecodeError> {
    if payload.len() != 3 {
        return Err(DecodeError::InvalidPayloadLength {
            event_type: 0x01,
            actual: payload.len(),
        });
    }
    Ok(BleKeyboardEvent::Key {
        action: decode_action(payload[0])?,
        position: payload[1],
        layer: payload[2],
    })
}

fn decode_combo(payload: &[u8]) -> Result<BleKeyboardEvent, DecodeError> {
    if !(5..=9).contains(&payload.len()) {
        return Err(DecodeError::InvalidPayloadLength {
            event_type: 0x02,
            actual: payload.len(),
        });
    }
    let combo_id = read_u16(&payload[0..2]);
    let position_count = payload[4] as usize;
    if combo_id == 0 || position_count > MAX_COMBO_POSITIONS || payload.len() != 5 + position_count
    {
        return Err(DecodeError::InvalidCombo);
    }
    Ok(BleKeyboardEvent::Combo {
        combo_id,
        action: decode_action(payload[2])?,
        layer: payload[3],
        positions: payload[5..].to_vec(),
    })
}

fn decode_layer(payload: &[u8]) -> Result<BleKeyboardEvent, DecodeError> {
    if payload.len() != 4 {
        return Err(DecodeError::InvalidPayloadLength {
            event_type: 0x03,
            actual: payload.len(),
        });
    }
    if payload[2] > 3 {
        return Err(DecodeError::InvalidLayerCause(payload[2]));
    }
    Ok(BleKeyboardEvent::Layer {
        layer: payload[0],
        previous_layer: payload[1],
        cause: payload[2],
        origin_position: payload[3],
    })
}

fn decode_diagnostic(payload: &[u8]) -> Result<BleKeyboardEvent, DecodeError> {
    if payload.len() != 12 {
        return Err(DecodeError::InvalidPayloadLength {
            event_type: 0x05,
            actual: payload.len(),
        });
    }
    if payload[2] > 2 {
        return Err(DecodeError::InvalidDiagnosticSeverity(payload[2]));
    }
    Ok(BleKeyboardEvent::Diagnostic {
        code: read_u16(&payload[0..2]),
        severity: payload[2],
        source: payload[3],
        count: read_u32(&payload[4..8]),
        detail: read_u32(&payload[8..12]),
    })
}

fn decode_action(value: u8) -> Result<InputAction, DecodeError> {
    match value {
        0 => Ok(InputAction::Up),
        1 => Ok(InputAction::Down),
        _ => Err(DecodeError::InvalidAction(value)),
    }
}

fn read_u16(data: &[u8]) -> u16 {
    u16::from_le_bytes([data[0], data[1]])
}

fn read_u32(data: &[u8]) -> u32 {
    u32::from_le_bytes([data[0], data[1], data[2], data[3]])
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SequenceObservation {
    Baseline,
    Contiguous,
    Gap {
        expected: u32,
        actual: u32,
        distance: u32,
    },
}

#[derive(Default)]
pub struct SequenceTracker {
    last: Option<u32>,
}

impl SequenceTracker {
    pub fn observe(&mut self, frame: &DecodedBleKeyboardFrame) -> SequenceObservation {
        if frame.stream_start() || self.last.is_none() {
            self.last = Some(frame.sequence);
            return SequenceObservation::Baseline;
        }

        let expected = self.last.unwrap().wrapping_add(1);
        self.last = Some(frame.sequence);
        if frame.sequence == expected {
            SequenceObservation::Contiguous
        } else {
            SequenceObservation::Gap {
                expected,
                actual: frame.sequence,
                distance: frame.sequence.wrapping_sub(expected),
            }
        }
    }

    pub fn clear(&mut self) {
        self.last = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../tests/fixtures/ble/keyboard-events-v1.json"
        ))
        .unwrap()
    }

    fn bytes(hex: &str) -> Vec<u8> {
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    fn frame(name: &str) -> Vec<u8> {
        let fixture = fixture();
        let event = fixture["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|event| event["name"] == name)
            .unwrap();
        bytes(event["hex"].as_str().unwrap())
    }

    #[test]
    fn decodes_reviewed_capabilities_and_accepts_minor_versions() {
        let fixture = fixture();
        let mut data = bytes(fixture["capabilities"]["hex"].as_str().unwrap());
        data[1] = 7;
        let capabilities = decode_capabilities(&data).unwrap();
        assert_eq!(capabilities.protocol_minor, 7);
        assert_eq!(capabilities.flags, 0x77);
        assert_eq!(capabilities.max_frame_length, 20);
        assert_eq!(capabilities.position_schema, 1);
    }

    #[test]
    fn rejects_unsupported_or_invalid_capabilities() {
        assert_eq!(
            decode_capabilities(&[1, 0]),
            Err(DecodeError::InvalidCapabilitiesLength(2))
        );
        let mut data = bytes("0100770014010000");
        data[0] = 2;
        assert_eq!(
            decode_capabilities(&data),
            Err(DecodeError::UnsupportedProtocolMajor(2))
        );
        data[0] = 1;
        data[2] |= 1 << 3;
        assert_eq!(
            decode_capabilities(&data),
            Err(DecodeError::ReservedCapabilitySet)
        );
    }

    #[test]
    fn decodes_reviewed_minimal_event_frames() {
        let key = decode_frame(&frame("key-down")).unwrap();
        assert_eq!(key.sequence, 42);
        assert_eq!(
            key.event,
            BleKeyboardEvent::Key {
                action: InputAction::Down,
                position: 1,
                layer: 1,
            }
        );

        let combo = decode_frame(&frame("combo-activated")).unwrap();
        assert_eq!(
            combo.event,
            BleKeyboardEvent::Combo {
                action: InputAction::Down,
                combo_id: 1,
                positions: vec![1, 2],
                layer: 1,
            }
        );

        assert!(matches!(
            decode_frame(&frame("stream-start-layer-snapshot"))
                .unwrap()
                .event,
            BleKeyboardEvent::Layer { cause: 3, .. }
        ));
        assert!(matches!(
            decode_frame(&frame("queue-overflow-diagnostic"))
                .unwrap()
                .event,
            BleKeyboardEvent::Diagnostic {
                code: 1,
                count: 3,
                detail: 48,
                ..
            }
        ));
    }

    #[test]
    fn rejects_reserved_unknown_and_malformed_frames_without_text_fields() {
        assert_eq!(
            decode_frame(&bytes("0104000001000000")),
            Err(DecodeError::UnsupportedEventType(4))
        );
        assert_eq!(
            decode_frame(&bytes("01ff000001000000")),
            Err(DecodeError::UnsupportedEventType(0xff))
        );
        assert!(matches!(
            decode_frame(&bytes("010100032a0000000101")),
            Err(DecodeError::InvalidPayloadLength { .. })
        ));
        assert!(matches!(
            decode_frame(&bytes("010100032a000000020101")),
            Err(DecodeError::InvalidAction(2))
        ));

        let serialized = serde_json::to_value(decode_frame(&frame("key-down")).unwrap()).unwrap();
        let serialized = serialized.to_string();
        for prohibited in ["text", "keycode", "hidUsage", "unicode", "behavior"] {
            assert!(!serialized.contains(prohibited));
        }

        let combo = serde_json::to_value(decode_frame(&frame("combo-activated")).unwrap()).unwrap();
        assert_eq!(combo["event"]["comboId"], 1);
    }

    #[test]
    fn tracks_gaps_wraps_stream_starts_and_clear() {
        let mut tracker = SequenceTracker::default();
        let mut current = decode_frame(&frame("key-down")).unwrap();
        assert_eq!(tracker.observe(&current), SequenceObservation::Baseline);
        current.sequence = 43;
        assert_eq!(tracker.observe(&current), SequenceObservation::Contiguous);
        current.sequence = 45;
        assert_eq!(
            tracker.observe(&current),
            SequenceObservation::Gap {
                expected: 44,
                actual: 45,
                distance: 1,
            }
        );
        current.sequence = u32::MAX;
        current.flags = 1;
        assert_eq!(tracker.observe(&current), SequenceObservation::Baseline);
        current.sequence = 0;
        current.flags = 0;
        assert_eq!(tracker.observe(&current), SequenceObservation::Contiguous);
        tracker.clear();
        assert_eq!(tracker.observe(&current), SequenceObservation::Baseline);
    }
}
