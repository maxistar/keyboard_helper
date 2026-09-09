import { AndroidBleTransport } from "./ble_transport.js";
import { AppVisibility, BleLifecycleCoordinator } from "./ble_lifecycle.js";
import { ConnectionEvidenceController } from "./connection_evidence.js";
import { createMobileConnectionOverviewView } from "./connection_overview.js";
import { MobileLayoutPresentationController } from "./layout_live_presentation.js";
import { createMobileLayoutViewerView } from "./layout_viewer.js";
import { MobileLayoutViewerModel } from "./layout_viewer_model.js";
import { NativeBleAdapter } from "./native_ble_adapter.js";
import { MobileTelemetryController } from "./telemetry_session.js";

const EXTENSION_SERVICE_UUID = "b34a0001-e782-4706-8f9c-6c056c416507";
const CAPABILITIES_CHARACTERISTIC_UUID = "b34a0003-e782-4706-8f9c-6c056c416507";

const viewerModel = new MobileLayoutViewerModel();

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
  createMobileLayoutViewerView(document, viewerModel, presentation);
  const overview = createMobileConnectionOverviewView(document, coordinator, evidence);
  document.addEventListener("visibilitychange", () => {
    const visibility = document.visibilityState === "hidden"
      ? AppVisibility.BACKGROUND
      : AppVisibility.FOREGROUND;
    void coordinator.setVisibility(visibility);
  });
  coordinator.initialize().catch(() => overview.reportError());
} catch (_error) {
  createMobileLayoutViewerView(document, viewerModel);
  const live = document.getElementById("connection-live");
  if (live) {
    live.textContent = "Connection support could not be initialized.";
    live.dataset.level = "error";
  }
  document.querySelectorAll(".connection-card button").forEach((button) => { button.disabled = true; });
}
