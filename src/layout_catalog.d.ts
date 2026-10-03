export { normalizeKeyEntry, normalizeLayerData } from "./layout_semantics.js";
export type LayoutModel = {
  name?: string;
  keySize?: import("./keyboard_renderer.js").KeySize;
  keys: Array<import("./layout_semantics.js").KeyPosition & { label: string; code: string }>;
};
export function buildLayout(definition: import("./layout_semantics.js").LayoutDefinition, layers: import("./layout_semantics.js").KeyEntry[][]): LayoutModel;
