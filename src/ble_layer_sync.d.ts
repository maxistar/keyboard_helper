export type BleLayerSource = {
  deviceName: string;
  serviceUuid: string;
  characteristicUuid: string;
  format: "int32-le";
};
export type BleLayerStatus = {
  available?: boolean;
  layoutKey?: string | null;
  state?: string;
  message?: string | null;
  writable?: boolean;
};
export type BleLayerSyncController = {
  start(layoutKey: string | null | undefined, source: BleLayerSource | null | undefined): Promise<unknown>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  writeLayer(layer: number, acceptableLayers?: readonly number[]): Promise<unknown>;
  getActiveLayoutKey(): string | null;
};
export function normalizeBleLayerSource(layoutDefinition: import("./layout_semantics.js").LayoutDefinition): BleLayerSource | null;
export function createBleLayerSyncController(options: {
  tauri: unknown;
  onLayerChange: (layer: number, details?: { source?: string }) => void;
  onStatusChange?: (status: BleLayerStatus) => void;
}): BleLayerSyncController;
