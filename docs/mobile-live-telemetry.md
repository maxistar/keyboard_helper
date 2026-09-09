# Mobile live telemetry

The Android companion treats Keyboard Helper event telemetry as a read-only enhancement. A stock
keyboard, incomplete extension, malformed capability value, or unsupported protocol major keeps the
connection overview and manual Browse viewer usable without starting an event subscription.

## Browse and Live ownership

Browse retains the user's process-local layout and layer selection. Live is a separate ephemeral
presentation derived from the current BLE lifecycle generation. It becomes authoritative only after
the phone receives its own valid `STREAM_START | SNAPSHOT` layer frame. Leaving Live or losing the
generation reveals the unchanged Browse selection and clears all held key and combo highlights.

Firmware layer events own the persistent Live layer. Key and combo layer bytes are context only.
Physical positions and combo IDs are mapped through the manually selected bundled layout; an absent
layer, position, or combo produces a bounded mismatch instead of selecting unrelated metadata. This
is why the mobile app has no remote layer control: unlike desktop input-source synchronization, the
phone observes the keyboard and must not command it.

The session stores no typing history and performs no HID/text inference, analytics, persistence,
network request, background subscription, or characteristic write. Diagnostics are a small bounded
current-generation summary and never expose raw frames or native errors as product telemetry.

## Connection and stream troubleshooting

- **Live unavailable:** confirm the connection overview says enhanced and reports compatible v1
  capabilities with at least one key, combo, layer, or diagnostic event flag.
- **Waiting for Live:** disconnect and reconnect from the Companion so Android performs a confirmed
  CCC reset and enrollment. Pairing/encryption UI may need to complete before the stream boundary.
- **Sequence gap:** transient key and combo state is cleared immediately. Continued valid frames may
  restore Live state without reconnecting or affecting another subscriber.
- **Layout mismatch:** select the bundled JSON that matches the flashed keymap. A message such as
  `Layer 12 is not available in current layout` describes presentation metadata, not BLE failure.
- **After backgrounding or Bluetooth loss:** return to the foreground and use the existing connection
  recovery actions. Telemetry owns no independent retry policy.

## Subscriber-isolation acceptance method

The deliberate loss test uses an acceptance-only enhanced central build. It is not part of either
firmware CI matrix and must not be distributed as a normal artifact. Build it with:

```text
-DCONFIG_ZMK_KEYBOARD_HELPER_EXTENSION=y
-DCONFIG_ZMK_KEYBOARD_HELPER_TEST_DROP_SECOND_SUBSCRIBER=y
```

The test-only hook is disabled by default. With desktop enrolled first and mobile second,
it omits every second non-snapshot notification only for mobile while advancing only that
subscriber's cursor. Initial snapshots remain intact. The next delivered mobile frame therefore has
a deterministic sequence gap, while desktop receives the complete sequence and keyboard HID follows
the normal path. This tests loss handling without shrinking the shared production queue or changing
retry policy.

Before flashing, verify the test image's resolved `.config` enables the test hook. After the test,
restore the ordinary enhanced central image and verify its `.config` leaves the hook disabled.

The 2026-09-09 acceptance build resolved the hook to `y`, used 270,312 B FLASH and 87,914 B RAM,
and produced SHA-256 `2efaf0f1b722ac2d2b4547b04566e64501e9a1e70518a28027e297e5f1c61457`.
The control enhanced build resolved the hook to `not set`, used 270,264 B FLASH and 87,906 B RAM,
and produced SHA-256 `20bc32050c30af0fe0c676af1bf6de493fb1f31f8f23874efb19ce73e8bc07ac`.
Both builds completed with the pinned ZMK `v0.2.1` toolchain.

## Physical acceptance record

- Date: 2026-09-09
- Phone: Xiaomi `2511FPC34G`, Android 16 / API 36, arm64
- Firmware capabilities: v1, 8 bytes, `01 00 77 00 14 01 00 00`
- Clients: Keyboard Helper desktop first; Android Companion second
- Single-client Live: pass for encrypted enrollment, subscriber-local stream start, layer changes,
  physical key highlighting on both halves, Browse switching, and disconnect cleanup
- Concurrent clients: pass; independent disconnect/reconnect and mobile background/resume did not
  interrupt the other subscriber or keyboard HID behavior
- Layout evidence: the deliberately selected non-matching JSON produced the expected bounded
  `Layer 12 is not available in current layout` message while telemetry and highlighting remained
  functional
- Subscriber-loss injection: pass with the acceptance-only fault image. Desktop enrolled first and
  mobile second. Android reported the expected bounded sequence gap and cleared transient key state
  on the next delivered frame; desktop telemetry remained continuous and keyboard HID input remained
  correct. Neither client restarted or took ownership from the other.
- Stream and ordering evidence: each client received its own initial stream boundary. Ordinary
  concurrent layer/key/combo behavior matched before injection; the deterministic alternate-frame
  omission affected only the second subscriber and produced the expected subscriber-local gap.
- Responsive/accessibility: pass for the physical visual observations exercised in portrait—the
  Browse/Live controls, stream status, current layer, keyboard region, pressed-key state, mismatch,
  and gap copy remained visible and operable without focus movement or page-level overflow. The
  pressed state and mode/status were not color-only. Automated DOM, keyboard-focus, live-region,
  320-pixel portrait, and short-landscape checks passed; TalkBack was not separately exercised.
- Production restore: pass. The ordinary enhanced control image with the fault hook resolved to
  `not set` was restored to the central half, and the maintainer confirmed normal Android Live,
  desktop telemetry, and HID behavior without artificial sequence gaps.
- Conclusion: enhanced mobile telemetry and concurrent-subscriber acceptance pass.
