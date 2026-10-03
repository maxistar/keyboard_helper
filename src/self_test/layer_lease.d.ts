export type LayerLeaseRequest = { generation?: unknown; layoutKey?: unknown; layer?: unknown; layerKey?: unknown; [key: string]: unknown };
export type LayerLeaseCoordinator = {
  acquire(request: LayerLeaseRequest): void;
  reassert(generation: unknown): void;
  release(generation: unknown): void;
  invalidateGeneration(generation: unknown, reason: string): void;
  observeLayer(layer: number | null): void;
  reportUnavailable(message: string): void;
  invalidate(reason: string): void;
};
export function matchesOrderedLayerRequest(layerKeys: string[], request: LayerLeaseRequest): boolean;
export function createSelfTestLayerLeaseCoordinator(options: {
  getActiveLayoutKey: () => string | null;
  getObservedLayer: () => number | null;
  isWritable: () => boolean;
  validateLayerRequest: (request: LayerLeaseRequest) => boolean;
  writeLayer: (layer: number, acceptableLayers?: readonly number[]) => Promise<unknown>;
  setReconciliationSuspended: (suspended: boolean) => void;
  onStatus: (status: unknown) => void;
}): LayerLeaseCoordinator;
