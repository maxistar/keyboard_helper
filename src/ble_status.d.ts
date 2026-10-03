export type BleKeyboardFormattedStatus = { summary: string; detail: string; battery: string };
export function formatBleKeyboardStatus(inputStatus: unknown, bleStatus: unknown, batteryLevel: unknown): BleKeyboardFormattedStatus;
