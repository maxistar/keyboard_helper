use tauri::{command, ipc::Channel, AppHandle, Runtime};

use crate::{models::*, KeyboardHelperBleExt, Result};

#[command]
pub(crate) async fn permission_status<R: Runtime>(app: AppHandle<R>) -> Result<PermissionStatus> {
    app.keyboard_helper_ble().permission_status()
}

#[command]
pub(crate) async fn request_permissions<R: Runtime>(app: AppHandle<R>) -> Result<PermissionStatus> {
    app.keyboard_helper_ble().request_permissions()
}

#[command]
pub(crate) async fn bluetooth_availability<R: Runtime>(
    app: AppHandle<R>,
) -> Result<BluetoothAvailability> {
    app.keyboard_helper_ble().bluetooth_availability()
}

#[command]
pub(crate) async fn observe_bluetooth_availability<R: Runtime>(
    app: AppHandle<R>,
    on_event: Channel<BluetoothAvailability>,
) -> Result<()> {
    app.keyboard_helper_ble()
        .observe_bluetooth_availability(ObserveAvailabilityRequest { on_event })
}

#[command]
pub(crate) async fn stop_observing_bluetooth_availability<R: Runtime>(
    app: AppHandle<R>,
) -> Result<()> {
    app.keyboard_helper_ble()
        .stop_observing_bluetooth_availability()
}

#[command]
pub(crate) async fn start_scan<R: Runtime>(
    app: AppHandle<R>,
    timeout_ms: u64,
    on_event: Channel<ScanEvent>,
) -> Result<()> {
    app.keyboard_helper_ble().start_scan(StartScanRequest {
        timeout_ms,
        on_event,
    })
}

#[command]
pub(crate) async fn stop_scan<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.keyboard_helper_ble().stop_scan()
}

#[command]
pub(crate) async fn connect<R: Runtime>(
    app: AppHandle<R>,
    address: String,
    attempt: u64,
    on_disconnect: Channel<Notification>,
) -> Result<()> {
    app.keyboard_helper_ble().connect(ConnectRequest {
        address,
        attempt,
        on_disconnect,
    })
}

#[command]
pub(crate) async fn list_services<R: Runtime>(
    app: AppHandle<R>,
    attempt: u64,
) -> Result<Vec<Service>> {
    app.keyboard_helper_ble()
        .list_services(AttemptRequest { attempt })
}

#[command]
pub(crate) async fn read<R: Runtime>(
    app: AppHandle<R>,
    attempt: u64,
    service_uuid: String,
    characteristic_uuid: String,
) -> Result<Vec<u8>> {
    app.keyboard_helper_ble().read(GattRequest {
        attempt,
        service_uuid,
        characteristic_uuid,
    })
}

#[command]
pub(crate) async fn subscribe<R: Runtime>(
    app: AppHandle<R>,
    attempt: u64,
    service_uuid: String,
    characteristic_uuid: String,
    on_notification: Channel<Notification>,
) -> Result<()> {
    app.keyboard_helper_ble().subscribe(SubscribeRequest {
        attempt,
        service_uuid,
        characteristic_uuid,
        on_notification,
    })
}

#[command]
pub(crate) async fn unsubscribe<R: Runtime>(
    app: AppHandle<R>,
    attempt: u64,
    service_uuid: String,
    characteristic_uuid: String,
) -> Result<()> {
    app.keyboard_helper_ble().unsubscribe(GattRequest {
        attempt,
        service_uuid,
        characteristic_uuid,
    })
}

#[command]
pub(crate) async fn disconnect<R: Runtime>(app: AppHandle<R>, attempt: u64) -> Result<()> {
    app.keyboard_helper_ble()
        .disconnect(AttemptRequest { attempt })
}
