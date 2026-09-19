import { createMacosInputSourceController } from "./macos_input_source.js";
import { detectRuntimePlatform } from "./input_source_sync_config.js";

/** @typedef {import("./input_source_sync_config.js").RuntimePlatform} RuntimePlatform */
/** @typedef {import("./input_source_sync_config.js").InputSourceSyncConfig} InputSourceSyncConfig */
/** @typedef {{ observe: boolean, select: boolean, listAvailable: boolean }} InputSourceAdapterCapabilities */
/** @typedef {{ platform: RuntimePlatform, supported: boolean, reason: string | null, message: string | null, capabilities: InputSourceAdapterCapabilities }} InputSourceAdapterStatus */

/** @param {RuntimePlatform} platform */
function unsupportedMessage(platform) {
  if (platform === "windows") return "Input Source Sync is not available on Windows yet.";
  if (platform === "linux") return "Input Source Sync is not available on Linux yet.";
  if (platform === "macos") return "Input Source Sync requires the Tauri macOS bridge.";
  return "Input Source Sync is not available on this platform.";
}

/**
 * @param {{ platform: RuntimePlatform, reason?: string }} options
 */
export function createUnsupportedInputSourceAdapter({ platform, reason = "unsupported-platform" }) {
  const capabilities = Object.freeze({ observe: false, select: false, listAvailable: false });
  const status = Object.freeze({
    platform,
    supported: false,
    reason,
    message: unsupportedMessage(platform),
    capabilities,
  });

  return {
    platform,
    supported: false,
    capabilities,
    getStatus: () => status,
    async start() {
      return false;
    },
    async stop() {},
    async refresh() {
      return null;
    },
    async select(sourceId) {
      throw new Error(`${status.message} Cannot select '${sourceId}'.`);
    },
    dispose() {
      return this.stop();
    },
    getCurrentSourceId: () => null,
    getAvailableSourceIds: () => new Set(),
    getActiveLayoutKey: () => null,
  };
}

/**
 * @param {{
 *   platform?: RuntimePlatform,
 *   tauri?: unknown,
 *   onSourceChange?: (sourceId: string, detail?: unknown) => void,
 *   onAvailabilityChange?: (ids: Set<string>) => void,
 *   onError?: (error: unknown) => void,
 * }} options
 */
export function createPlatformInputSourceAdapter({
  platform = detectRuntimePlatform(),
  tauri,
  onSourceChange = () => {},
  onAvailabilityChange = () => {},
  onError = () => {},
} = {}) {
  const hasNativeBridge = Boolean(tauri?.core?.invoke && tauri?.event?.listen);
  if (platform === "macos" && hasNativeBridge) {
    const macos = createMacosInputSourceController({
      tauri,
      onSourceChange: (sourceId, detail = {}) => onSourceChange(sourceId, { platform, ...detail }),
      onAvailabilityChange,
      onError,
    });
    const capabilities = Object.freeze({ observe: true, select: true, listAvailable: true });
    return {
      ...macos,
      platform,
      supported: true,
      capabilities,
      getStatus: () => ({
        platform,
        supported: true,
        reason: null,
        message: null,
        capabilities,
      }),
    };
  }

  return createUnsupportedInputSourceAdapter({
    platform,
    reason: platform === "macos" ? "native-bridge-unavailable" : "unsupported-platform",
  });
}
