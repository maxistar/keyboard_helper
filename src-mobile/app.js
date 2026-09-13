import { AndroidBleTransport } from "./ble_transport.js";
import { AppVisibility, BleLifecycleCoordinator } from "./ble_lifecycle.js";
import { ConnectionEvidenceController } from "./connection_evidence.js";
import { createMobileConnectionOverviewView } from "./connection_overview.js";
import { CustomLayoutController } from "./custom_layouts.js";
import { MobileLayoutPresentationController } from "./layout_live_presentation.js";
import { createMobileLayoutViewerView } from "./layout_viewer.js";
import { MobileLayoutViewerModel } from "./layout_viewer_model.js";
import { NativeBleAdapter } from "./native_ble_adapter.js";
import { NativeLayoutAdapter } from "./native_layout_adapter.js";
import { MobileTelemetryController } from "./telemetry_session.js";

const EXTENSION_SERVICE_UUID = "b34a0001-e782-4706-8f9c-6c056c416507";
const CAPABILITIES_CHARACTERISTIC_UUID = "b34a0003-e782-4706-8f9c-6c056c416507";

const viewerModel = new MobileLayoutViewerModel();
const customLayouts = new CustomLayoutController(viewerModel, new NativeLayoutAdapter(), {
  createImageBitmap: globalThis.createImageBitmap?.bind(globalThis),
  requireCompleteDecoding: true,
});
window.addEventListener("pagehide", () => customLayouts.dispose(), { once: true });

try {
  const coordinator = new BleLifecycleCoordinator(
    new AndroidBleTransport(new NativeBleAdapter()),
    {
      extensionServiceUuid: EXTENSION_SERVICE_UUID,
      capabilitiesCharacteristicUuid: CAPABILITIES_CHARACTERISTIC_UUID,
    },
  );
  const evidence = new ConnectionEvidenceController(coordinator);
  const telemetry = new MobileTelemetryController(coordinator);
  const presentation = new MobileLayoutPresentationController(viewerModel, telemetry);
  const viewer = createMobileLayoutViewerView(document, viewerModel, presentation, {
    layoutController: customLayouts,
  });
  const overview = createMobileConnectionOverviewView(document, coordinator, evidence);
  document.addEventListener("visibilitychange", () => {
    const visibility = document.visibilityState === "hidden"
      ? AppVisibility.BACKGROUND
      : AppVisibility.FOREGROUND;
    void coordinator.setVisibility(visibility);
  });
  coordinator.initialize().catch(() => overview.reportError());
  customLayouts.initialize().catch((error) => {
    viewer.reportLayoutStatus(error?.message ?? "Custom layouts could not be loaded.", "error");
  });
} catch (_error) {
  const viewer = createMobileLayoutViewerView(document, viewerModel, null, {
    layoutController: customLayouts,
  });
  customLayouts.initialize().catch((error) => {
    viewer.reportLayoutStatus(error?.message ?? "Custom layouts could not be loaded.", "error");
  });
  const live = document.getElementById("connection-live");
  if (live) {
    live.textContent = "Connection support could not be initialized.";
    live.dataset.level = "error";
  }
  document.querySelectorAll(".connection-card button").forEach((button) => { button.disabled = true; });
}
