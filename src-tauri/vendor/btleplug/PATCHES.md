# Local changes from btleplug 0.12.0

Source: crates.io btleplug 0.12.0. Upstream license: LICENSE.md.

The Windows Central::add_peripheral implementation now accepts a known Bluetooth
address and reuses existing entries. A crate-private PeripheralId accessor supplies
the address to the existing Peripheral constructor. Other backends are unchanged.

Keyboard Helper uses Windows paired-device enumeration to obtain the address when
a keyboard is already connected as HID and is no longer advertising. GATT service
and characteristic validation still use the existing btleplug connection path.
