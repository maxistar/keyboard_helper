export type BleHighlightController = { clear(): void; handleEvent(event: import("./input_events.js").NormalizedInputEvent): void };
export function createBleHighlightController(options: {
  resolvePosition: (position: number) => Element | number | null;
  setPositionPressed?: (position: number, active: boolean) => boolean;
  getPositionLabel?: (position: number) => string;
  setComboActive: (comboId: number, active: boolean) => boolean;
  showPositionLabel: (target: Element | number | string, event: { position: number }) => void;
  reportDiagnostic: (diagnostic: { code: string; event: { comboId?: number; position?: number } }) => void;
}): BleHighlightController;
