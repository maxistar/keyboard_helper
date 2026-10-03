export type PressedKeyTracker = {
  remember(code: string, element: Element): void;
  release(code: string, fallback: Element | null): Element | null;
  clear(): void;
};

export function createPressedKeyTracker(): PressedKeyTracker;
export function resolveKeyElement(document: Document, code: string, shift: boolean, altGr: boolean): Element | null;
