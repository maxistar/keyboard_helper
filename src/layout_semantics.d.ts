export type KeyPosition = { row: number; col: number; x?: number; y?: number; width?: number; height?: number; [key: string]: unknown };
export type KeyEntry = { label: string; code: string; [key: string]: unknown };
export type LayoutDefinition = {
  name?: string;
  keySize?: number;
  keyPositions?: KeyPosition[];
  keyLayers?: unknown;
  combos?: unknown[];
  bleLayerSource?: unknown;
  inputSourceSync?: unknown;
  [key: string]: unknown;
};
export type NormalizedLayerData = {
  layers: KeyEntry[][];
  names: string[];
  layerKeys: string[];
};

export function parseLayoutJson(raw: string): LayoutDefinition;
export function normalizeKeyEntry(entry: unknown): KeyEntry;
export function normalizeLayerData(rawLayers: unknown): NormalizedLayerData;
