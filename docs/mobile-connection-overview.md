# Mobile Connection Overview

## Purpose and scope

The Android companion presents a product connection journey above the independent layout viewer.
It turns the accepted foreground BLE lifecycle into clear status, actions, device selection, and
optional standard keyboard details. It does not expose raw GATT operations, extension events,
telemetry, key or layer activity, or remote controls.

The same base journey applies to both keyboard profiles:

- **Stock** means the keyboard provides ordinary ZMK-compatible Bluetooth services but not the
  Keyboard Helper extension.
- **Enhanced** means the extension was detected. The label is additive; it does not change the
  connection actions or expose extension-only interactions in this stage.

The layout viewer remains usable and keeps its selected layout and layer throughout every
connection state.

## Product journey

```text
Find keyboard
      │ just-in-time Nearby devices request
      ▼
bounded scan ── select result ── Connect ── prepare services ── Connected
      │                                                          │
      └── empty/actionable                                optional BAS/DIS

Connected ── unexpected loss ── bounded reconnect ── Connected
                                      └── exhausted ── explicit Reconnect

Connected ── explicit Disconnect ── Disconnected (no automatic reconnect)
```

Nearby devices access is requested only after **Find keyboard**. A denied request, Bluetooth-off
state, empty scan, connection failure, or exhausted reconnect is presented as an actionable state;
none starts a silent scan or unbounded retry loop.

Device selection and connection intent are process-local. A cold process starts without a selected
keyboard, reconnect intent, retained address, evidence, or retry ownership. The visible device name
is a temporary summary; the native identifier is not displayed or retained as product diagnostics.

## Standard evidence allowlist

Standard evidence is read only after the lifecycle reaches `ready`, one GATT request at a time, and
is bound to that lifecycle generation. A disconnect, background cleanup, or new generation clears
the evidence atomically; late reads cannot repopulate it.

The fixed allowlist is:

| Service | Characteristic | Presentation |
|---|---|---|
| Battery Service (`180F`) | Battery Level (`2A19`) | Percentage from a valid single byte, 0–100 |
| Device Information (`180A`) | Manufacturer Name (`2A29`) | Bounded UTF-8 text |
| Device Information (`180A`) | Model Number (`2A24`) | Bounded UTF-8 text |
| Device Information (`180A`) | Firmware Revision (`2A26`) | Bounded UTF-8 text |
| Device Information (`180A`) | Hardware Revision (`2A27`) | Bounded UTF-8 text |
| Device Information (`180A`) | Software Revision (`2A28`) | Bounded UTF-8 text |

Serial Number, System ID, IEEE certification data, PnP ID, unknown characteristics, raw bytes, and
extension notifications are excluded. There are no characteristic writes, persistence, network
requests, background services, or UI-owned retry timers.

## Partial and unavailable details

Battery and every Device Information field are independent. Missing services or characteristics
show **Not available**. Invalid values show **Invalid value**. Read failures show **Could not read**.
A successful sibling remains visible, and optional evidence never changes a ready connection into a
connection failure. Diagnostics use fixed bounded product copy and do not include native error text.

## Troubleshooting

- If the app asks for access, grant Nearby devices permission from the Android prompt. If Android
  no longer offers the prompt, enable it in the app settings.
- If Bluetooth is off, turn it on and return to the app; scanning does not begin automatically.
- If no result appears, put the keyboard in pairing/advertising mode and use **Find another
  keyboard** after the bounded scan ends.
- If reconnect attempts are exhausted, move the keyboard nearby and use **Reconnect**.
- If optional details are absent, the keyboard may legitimately omit BAS, DIS, or individual DIS
  characteristics. This does not indicate a failed connection.
- After a cold relaunch, use **Find keyboard** again; restoring the previous device or connection is
  intentionally outside this stage.

## Physical acceptance matrix

Final acceptance uses an arm64 Android API 31+ phone. Run the full base journey first with enhanced
firmware, then temporarily flash stock ZMK, and finally restore enhanced firmware. Record the phone
and API level, firmware profile, observed standard-service subset, partial states, and pass/fail for
permission, scan, selection, connection, recovery, explicit disconnect, background/resume, and cold
relaunch. The stock run must reach `ready / stock`; the restored enhanced run must reach
`ready / enhanced` with the same base overview and without extension interactions.

### Acceptance record

| Date | Phone / API | Firmware | Result |
|---|---|---|---|
| 2026-09-08 | Xiaomi `2511FPC34G`, Android 16 / API 36, arm64 | Enhanced | Pass: permission, bounded scan, selection, connection, standard details, recovery, explicit disconnect, background/resume, and cold relaunch behaved as specified. Capability was additive; no key, combo, layer, raw-notification, subscription, or remote-control interaction was exposed. |

On 2026-09-08 the maintainer explicitly deferred the stock-firmware run to avoid reflashing the
keyboard during this change. Deterministic extension-absent, missing/partial BAS/DIS, malformed,
failed-read, and generation-race coverage passed. No restoration run was needed because enhanced
firmware remained installed. Physical `ready / stock`, the actual BAS/DIS subset, disconnect, and
reconnect remain a required recorded gate before Stage 6 enhanced telemetry implementation begins.
