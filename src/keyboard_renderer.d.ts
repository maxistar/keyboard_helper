export type KeySize = { w: number; h: number; gap: number };
export type RenderKey = import("./layout_semantics.js").KeyPosition & {
  label: string;
  code: string;
  cls?: string;
  w?: string | number;
  h?: string | number;
  angle?: number;
};
export type OverlayCanvas = { originX: number; originY: number; width: number; height: number };
export const COMBO_BORDER_PADDING: number;
export function calcKeyBounds(key: import("./layout_semantics.js").KeyPosition, keySize: KeySize | number | undefined): { left: number; top: number; width: number; height: number };
export function calcOverlayCanvas(keys: import("./layout_semantics.js").KeyPosition[], keySize: KeySize | number | undefined): OverlayCanvas;
export function applyCanvasGeometry(element: HTMLElement, canvas: OverlayCanvas): void;
export function renderKeyLabel(element: Element, key: { label?: string; code?: string; [key: string]: unknown }): void;
