export type BleHighlightController = { clear(): void; handleEvent(event: import("./input_events.js").NormalizedInputEvent): void };
export function createBleHighlightController(options: {
  resolvePosition: (position: number) => Element | null;
  setComboActive: (comboId: number, active: boolean) => boolean;
  showPositionLabel: (element: Element, event: { position: number }) => void;
  reportDiagnostic: (diagnostic: { code: string; event: { comboId?: number; position?: number } }) => void;
}): BleHighlightController;
