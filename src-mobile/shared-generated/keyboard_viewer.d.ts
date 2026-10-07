export type KeyboardViewerKey = {
  row: number;
  col: number;
  w?: number;
  h?: number;
  widthUnits?: number;
  heightUnits?: number;
  angle?: number;
  cls?: string;
  kind?: string;
  label?: unknown;
  code?: string | null;
  image?: string | null;
  alt?: string | null;
  accessibleLabel?: string;
};

export type KeyboardViewerPresentation = {
  name?: string;
  keySize: { w: number; h: number; gap?: number };
  keys: KeyboardViewerKey[];
  width?: number;
  height?: number;
  origin?: { x: number; y: number };
  layers?: Array<{ index: number; name: string }>;
};

export type KeyboardViewerState = {
  layerIndex?: number;
  layerAuthoritative?: boolean;
  pressedPositions?: number[];
  comboPositions?: number[];
  keyMarkers?: Record<number, string>;
  interactive?: boolean;
};

export interface KeyboardLayoutViewerElement extends HTMLElement {
  setPresentation(presentation: KeyboardViewerPresentation | null, state?: KeyboardViewerState): void;
  setState(state: KeyboardViewerState): void;
  setLayer(layerIndex: number, options?: { authoritative?: boolean }): void;
  requestLayer(layerIndex: number): boolean;
  renderLayerControl(container: HTMLElement, layers: KeyboardViewerPresentation["layers"], layerIndex: number, options?: { variant?: "select" | "dots"; authoritative?: boolean }): void;
  setKeyMarkers(markers: Record<number, string> | null): void;
  setPositionPressed(position: number, active: boolean): boolean;
  clearPressed(): void;
  setComboPositions(positions: number[]): void;
  setKeyLabel(position: number, entry: Pick<KeyboardViewerKey, "label" | "code" | "image" | "alt" | "accessibleLabel">): boolean;
  hasPosition(position: number): boolean;
  keyLabelAt(position: number): string;
  resolveKeyPosition(code: string, shift?: boolean, altGr?: boolean): number | null;
}

export function renderKeyboardLayoutInto(
  root: HTMLElement,
  presentation: KeyboardViewerPresentation | null,
  state?: KeyboardViewerState,
  options?: { mobile?: boolean; document?: Document },
): HTMLElement[];

declare global {
  interface HTMLElementTagNameMap {
    "keyboard-layout-viewer": KeyboardLayoutViewerElement;
  }
}

export function isKeyboardLayoutViewer(element: Element | null): element is KeyboardLayoutViewerElement;
