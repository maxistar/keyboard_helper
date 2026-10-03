use crate::ble_layer_sync;
use std::sync::Arc;
use tauri::State;

#[derive(Default)]
pub(crate) struct BleLayerSyncTauriState {
    inner: Arc<ble_layer_sync::BleLayerSyncState>,
}

#[tauri::command]
pub(crate) fn start_ble_layer_sync(
    app_handle: tauri::AppHandle,
    state: State<BleLayerSyncTauriState>,
    config: ble_layer_sync::BleLayerSyncConfig,
) -> Result<(), String> {
    ble_layer_sync::start_sync(app_handle, state.inner.clone(), config);
    Ok(())
}

#[tauri::command]
pub(crate) fn stop_ble_layer_sync(state: State<BleLayerSyncTauriState>) {
    ble_layer_sync::stop_sync(state.inner.clone());
}

#[tauri::command]
pub(crate) fn write_ble_layer(
    state: State<BleLayerSyncTauriState>,
    layout_key: String,
    layer: u32,
    acceptable_layers: Vec<u32>,
) -> Result<(), String> {
    state
        .inner
        .request_layer(&layout_key, layer, acceptable_layers)
        .map_err(|error| error.to_string())
}
