const POLICY_LABELS = Object.freeze({
  auto: "Auto",
  ble: "BLE",
  system: "System listener",
});

const SOURCE_LABELS = Object.freeze({
  ble: "BLE",
  system: "System listener",
});

export function formatBleKeyboardStatus(inputStatus, bleStatus, batteryLevel = null) {
  const policy = POLICY_LABELS[inputStatus?.configuredPolicy] ?? "Auto";
  const effective = SOURCE_LABELS[inputStatus?.effectiveSource] ?? "Unavailable";
  const mode = bleStatus?.mode === "enhanced"
    ? "extension v1"
    : bleStatus?.mode === "stock"
      ? "stock ZMK"
      : bleStatus?.mode === "unsupported"
        ? "unsupported extension"
        : "not connected";
  const reason = inputStatus?.reason ?? bleStatus?.reason ?? null;
  return Object.freeze({
    summary: `${policy} · Active: ${effective}`,
    detail: reason ? `${mode} · ${reason}` : mode,
    battery: Number.isInteger(batteryLevel) ? `Battery ${batteryLevel}%` : "Battery unavailable",
  });
}
