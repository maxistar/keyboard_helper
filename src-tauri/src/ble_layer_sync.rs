use anyhow::{anyhow, Context, Result};
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    ValueNotification,
};
use btleplug::platform::{Manager, Peripheral};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;
use uuid::Uuid;

#[cfg(target_vendor = "apple")]
#[path = "ble_layer_macos.rs"]
mod ble_layer_macos;

const DEFAULT_SCAN_SECS: u64 = 2;
const PROBE_TIMEOUT_SECS: u64 = 2;
const NOTIFICATION_POLL_TIMEOUT_MS: u64 = 500;

#[derive(Default)]
pub struct BleLayerSyncState {
    generation: Arc<AtomicU64>,
}

impl BleLayerSyncState {
    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.current_generation() == generation
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BleLayerSyncConfig {
    pub layout_key: String,
    pub device_name: Option<String>,
    pub service_uuid: String,
    pub characteristic_uuid: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize)]
struct BleLayerUpdatePayload {
    layout: String,
    layer: u32,
}

#[derive(Debug, Clone, Serialize)]
struct BleLayerStatusPayload {
    layout: String,
    state: String,
    message: Option<String>,
}

#[derive(Debug)]
struct BtleKeyboard {
    peripheral: Peripheral,
    layer_char: Characteristic,
}

enum KeyboardHandle {
    Btle(BtleKeyboard),
    #[cfg(target_vendor = "apple")]
    Macos(ble_layer_macos::ConnectedKeyboard),
}

pub fn start_sync(app_handle: AppHandle, state: Arc<BleLayerSyncState>, config: BleLayerSyncConfig) {
    let generation = state.next_generation();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build BLE sync runtime");
        if let Err(error) = runtime.block_on(run_sync(
            app_handle.clone(),
            state.clone(),
            generation,
            config.clone(),
        )) {
            let _ = emit_status(&app_handle, &config.layout_key, "error", Some(error.to_string()));
        }
    });
}

pub fn stop_sync(state: Arc<BleLayerSyncState>) {
    state.next_generation();
}

async fn run_sync(
    app_handle: AppHandle,
    state: Arc<BleLayerSyncState>,
    generation: u64,
    config: BleLayerSyncConfig,
) -> Result<()> {
    ensure_supported_format(&config)?;
    emit_status(&app_handle, &config.layout_key, "connecting", None)?;

    let service_uuid = Uuid::parse_str(&config.service_uuid)
        .with_context(|| format!("invalid service UUID: {}", config.service_uuid))?;
    let characteristic_uuid = Uuid::parse_str(&config.characteristic_uuid)
        .with_context(|| format!("invalid characteristic UUID: {}", config.characteristic_uuid))?;

    let keyboard = find_keyboard(
        config.device_name.as_deref(),
        service_uuid,
        characteristic_uuid,
        DEFAULT_SCAN_SECS,
    )
    .await?;

    if !state.is_current(generation) {
        return Ok(());
    }

    let layer = read_active_layer(&keyboard).await?;
    emit_layer(&app_handle, &config.layout_key, layer)?;
    emit_status(&app_handle, &config.layout_key, "connected", None)?;

    watch_layers(
        &app_handle,
        state,
        generation,
        &config.layout_key,
        keyboard,
        layer,
    )
    .await
}

fn ensure_supported_format(config: &BleLayerSyncConfig) -> Result<()> {
    if config.format != "int32-le" {
        return Err(anyhow!("unsupported BLE layer format: {}", config.format));
    }
    Ok(())
}

async fn watch_layers(
    app_handle: &AppHandle,
    state: Arc<BleLayerSyncState>,
    generation: u64,
    layout_key: &str,
    keyboard: KeyboardHandle,
    mut last_layer: u32,
) -> Result<()> {
    match keyboard {
        KeyboardHandle::Btle(keyboard) => {
            let mut notifications = notification_stream(&keyboard).await?;
            while state.is_current(generation) {
                let next = tokio::time::timeout(
                    Duration::from_millis(NOTIFICATION_POLL_TIMEOUT_MS),
                    notifications.next(),
                )
                .await;

                let Some(notification) = (match next {
                    Ok(Some(notification)) => Some(notification),
                    Ok(None) => return Err(anyhow!("BLE notification stream ended")),
                    Err(_) => None,
                }) else {
                    continue;
                };

                if notification.uuid != keyboard.layer_char.uuid {
                    continue;
                }

                let layer = decode_active_layer(&notification.value)?;
                if layer != last_layer {
                    emit_layer(app_handle, layout_key, layer)?;
                    last_layer = layer;
                }
            }
        }
        #[cfg(target_vendor = "apple")]
        KeyboardHandle::Macos(keyboard) => {
            keyboard.start_notifications()?;
            while state.is_current(generation) {
                if let Some(layer) = keyboard
                    .wait_for_notification_layer_timeout(Duration::from_millis(
                        NOTIFICATION_POLL_TIMEOUT_MS,
                    ))?
                {
                    if layer != last_layer {
                        emit_layer(app_handle, layout_key, layer)?;
                        last_layer = layer;
                    }
                }
            }
        }
    }

    emit_status(app_handle, layout_key, "idle", None)?;
    Ok(())
}

async fn find_keyboard(
    name_filter: Option<&str>,
    service_uuid: Uuid,
    characteristic_uuid: Uuid,
    scan_secs: u64,
) -> Result<KeyboardHandle> {
    #[cfg(target_vendor = "apple")]
    if let Some(peripheral) =
        ble_layer_macos::find_connected_keyboard(service_uuid, characteristic_uuid, name_filter)?
    {
        return Ok(KeyboardHandle::Macos(peripheral));
    }

    let manager = Manager::new().await?;
    let adapters = manager.adapters().await?;
    let adapter = adapters
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("No BLE adapter found"))?;

    adapter.start_scan(ScanFilter::default()).await?;
    sleep(Duration::from_secs(scan_secs)).await;

    let peripherals = adapter.peripherals().await?;
    let mut fallback_candidates = Vec::new();

    for peripheral in peripherals {
        let Some(props) = peripheral.properties().await? else {
            continue;
        };

        if let Some(expected_name) = name_filter {
            if matches!(props.local_name.as_deref(), Some(actual_name) if actual_name == expected_name)
            {
                return Ok(KeyboardHandle::Btle(
                    connect_btle_keyboard(peripheral, service_uuid, characteristic_uuid).await?,
                ));
            }
        }

        let has_service = props.services.iter().any(|uuid| *uuid == service_uuid);
        if has_service {
            return Ok(KeyboardHandle::Btle(
                connect_btle_keyboard(peripheral, service_uuid, characteristic_uuid).await?,
            ));
        }

        fallback_candidates.push(peripheral);
    }

    for peripheral in fallback_candidates {
        let is_keyboard = tokio::time::timeout(
            Duration::from_secs(PROBE_TIMEOUT_SECS),
            peripheral_matches_keyboard(&peripheral, service_uuid, characteristic_uuid),
        )
        .await
        .unwrap_or(Ok(false))?;
        if !is_keyboard {
            continue;
        }

        if let Some(expected_name) = name_filter {
            let resolved_name = tokio::time::timeout(
                Duration::from_secs(PROBE_TIMEOUT_SECS),
                peripheral_name(&peripheral),
            )
            .await
            .unwrap_or(Ok(None))?;

            if resolved_name.as_deref() == Some(expected_name) {
                return Ok(KeyboardHandle::Btle(
                    connect_btle_keyboard(peripheral, service_uuid, characteristic_uuid).await?,
                ));
            }
        } else {
            return Ok(KeyboardHandle::Btle(
                connect_btle_keyboard(peripheral, service_uuid, characteristic_uuid).await?,
            ));
        }
    }

    if let Some(expected_name) = name_filter {
        Err(anyhow!("Keyboard named '{expected_name}' not found"))
    } else {
        Err(anyhow!("Keyboard with target service not found"))
    }
}

async fn peripheral_matches_keyboard(
    peripheral: &Peripheral,
    service_uuid: Uuid,
    characteristic_uuid: Uuid,
) -> Result<bool> {
    let was_connected = peripheral.is_connected().await?;
    if !was_connected && peripheral.connect().await.is_err() {
        return Ok(false);
    }

    let result = async {
        peripheral.discover_services().await?;
        let chars = peripheral.characteristics();
        let has_service = chars.iter().any(|c| c.service_uuid == service_uuid);
        let has_char = chars.iter().any(|c| c.uuid == characteristic_uuid);
        Ok::<bool, anyhow::Error>(has_service && has_char)
    }
    .await;

    if !was_connected {
        let _ = peripheral.disconnect().await;
    }

    result.or(Ok(false))
}

async fn peripheral_name(peripheral: &Peripheral) -> Result<Option<String>> {
    if let Some(props) = peripheral.properties().await? {
        if let Some(name) = props.local_name {
            return Ok(Some(name));
        }
    }
    Ok(None)
}

async fn connect_btle_keyboard(
    peripheral: Peripheral,
    service_uuid: Uuid,
    characteristic_uuid: Uuid,
) -> Result<BtleKeyboard> {
    if !peripheral.is_connected().await? {
        peripheral.connect().await?;
    }

    peripheral.discover_services().await?;
    let chars = peripheral.characteristics();
    let has_service = chars.iter().any(|c| c.service_uuid == service_uuid);
    if !has_service {
        return Err(anyhow!("Connected device does not expose the expected custom service"));
    }

    let layer_char = chars
        .iter()
        .find(|c| c.uuid == characteristic_uuid)
        .cloned()
        .ok_or_else(|| anyhow!("Layer characteristic not found"))?;

    if !layer_char.properties.contains(CharPropFlags::READ) {
        return Err(anyhow!("Layer characteristic is not readable"));
    }

    Ok(BtleKeyboard {
        peripheral,
        layer_char,
    })
}

async fn read_active_layer(handle: &KeyboardHandle) -> Result<u32> {
    match handle {
        KeyboardHandle::Btle(keyboard) => decode_active_layer(
            &keyboard
                .peripheral
                .read(&keyboard.layer_char)
                .await
                .context("failed to read BLE layer characteristic")?,
        ),
        #[cfg(target_vendor = "apple")]
        KeyboardHandle::Macos(keyboard) => keyboard.read_active_layer(),
    }
}

async fn notification_stream(
    keyboard: &BtleKeyboard,
) -> Result<impl futures_util::Stream<Item = ValueNotification> + Send> {
    if !keyboard.layer_char.properties.contains(CharPropFlags::NOTIFY) {
        return Err(anyhow!("Layer characteristic does not support notifications"));
    }

    let stream = keyboard.peripheral.notifications().await?;
    keyboard.peripheral.subscribe(&keyboard.layer_char).await?;
    Ok(stream)
}

fn decode_active_layer(data: &[u8]) -> Result<u32> {
    let bytes: [u8; 4] = data
        .try_into()
        .map_err(|_| anyhow!("Expected 4 bytes, got {}", data.len()))?;
    Ok(u32::from_le_bytes(bytes))
}

fn emit_layer(app_handle: &AppHandle, layout_key: &str, layer: u32) -> Result<()> {
    app_handle
        .emit(
            "ble_layer_update",
            BleLayerUpdatePayload {
                layout: layout_key.to_string(),
                layer,
            },
        )
        .map_err(|error| anyhow!("failed to emit ble_layer_update: {error}"))
}

fn emit_status(
    app_handle: &AppHandle,
    layout_key: &str,
    state: &str,
    message: Option<String>,
) -> Result<()> {
    app_handle
        .emit(
            "ble_layer_status",
            BleLayerStatusPayload {
                layout: layout_key.to_string(),
                state: state.to_string(),
                message,
            },
        )
        .map_err(|error| anyhow!("failed to emit ble_layer_status: {error}"))
}
