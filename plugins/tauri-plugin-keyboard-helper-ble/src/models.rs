use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub state: String,
    pub sdk_int: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothAvailability {
    pub state: String,
    pub supported: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    pub address: String,
    pub name: String,
    pub rssi: i32,
    pub is_connected: bool,
    pub is_bonded: bool,
    pub services: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ScanEvent {
    Device { device: DiscoveredDevice },
    Error { code: String, message: String },
    Stopped,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Characteristic {
    pub uuid: String,
    pub descriptors: Vec<String>,
    pub properties: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub uuid: String,
    pub characteristics: Vec<Characteristic>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServicesResponse {
    pub services: Vec<Service>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BytesResponse {
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub attempt: u64,
    pub service_uuid: String,
    pub characteristic_uuid: String,
    pub bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartScanRequest {
    pub timeout_ms: u64,
    pub on_event: Channel<ScanEvent>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObserveAvailabilityRequest {
    pub on_event: Channel<BluetoothAvailability>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectRequest {
    pub address: String,
    pub attempt: u64,
    pub on_disconnect: Channel<Notification>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttemptRequest {
    pub attempt: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GattRequest {
    pub attempt: u64,
    pub service_uuid: String,
    pub characteristic_uuid: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscribeRequest {
    pub attempt: u64,
    pub service_uuid: String,
    pub characteristic_uuid: String,
    pub on_notification: Channel<Notification>,
}
