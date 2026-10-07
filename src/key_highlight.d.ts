export type PressedKeyTracker = {
  remember(code: string, target: Element | number): void;
  release(code: string, fallback: Element | number | null): Element | number | null;
  clear(): void;
};

export function createPressedKeyTracker(): PressedKeyTracker;
export function resolveKeyElement(document: Document, code: string, shift: boolean, altGr: boolean): Element | null;
