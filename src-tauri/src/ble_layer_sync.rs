use anyhow::{anyhow, Context, Result};
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    ValueNotification, WriteType,
};
use btleplug::platform::{Manager, Peripheral};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;
use uuid::Uuid;

#[cfg(target_vendor = "apple")]
#[path = "ble_layer_macos.rs"]
mod ble_layer_macos;

const DEFAULT_SCAN_SECS: u64 = 2;
const PROBE_TIMEOUT_SECS: u64 = 2;
const NOTIFICATION_POLL_TIMEOUT_MS: u64 = 500;
const COMMAND_CONFIRM_TIMEOUT_SECS: u64 = 4;

struct LayerCommand {
    generation: u64,
    layer: u32,
    acceptable_layers: Vec<u32>,
    response: SyncSender<Result<(), String>>,
}

struct ActiveCommandSession {
    generation: u64,
    layout_key: String,
    sender: SyncSender<LayerCommand>,
}

struct PendingCommand {
    layer: u32,
    acceptable_layers: Vec<u32>,
    response: SyncSender<Result<(), String>>,
    deadline: Instant,
}

#[derive(Default)]
pub struct BleLayerSyncState {
    generation: Arc<AtomicU64>,
    command_session: Mutex<Option<ActiveCommandSession>>,
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

    fn install_command_session(
        &self,
        generation: u64,
        layout_key: String,
        sender: SyncSender<LayerCommand>,
    ) -> Result<()> {
        *self
            .command_session
            .lock()
            .map_err(|error| anyhow!(error.to_string()))? = Some(ActiveCommandSession {
            generation,
            layout_key,
            sender,
        });
        Ok(())
    }

    fn clear_command_session(&self, generation: u64) {
        if let Ok(mut session) = self.command_session.lock() {
            if session.as_ref().map(|active| active.generation) == Some(generation) {
                session.take();
            }
        }
    }

    pub fn request_layer(
        &self,
        layout_key: &str,
        layer: u32,
        acceptable_layers: Vec<u32>,
    ) -> Result<()> {
        if acceptable_layers.is_empty() || !acceptable_layers.contains(&layer) {
            return Err(anyhow!(
                "acceptableLayers must include the requested base layer"
            ));
        }
        let (response_sender, response_receiver) = mpsc::sync_channel(1);
        let (generation, sender) = {
            let session = self
                .command_session
                .lock()
                .map_err(|error| anyhow!(error.to_string()))?;
            let session = session
                .as_ref()
                .ok_or_else(|| anyhow!("BLE layer session is not writable or connected"))?;
            if session.layout_key != layout_key || !self.is_current(session.generation) {
                return Err(anyhow!("BLE layer session was replaced"));
            }
            (session.generation, session.sender.clone())
        };
        sender
            .send(LayerCommand {
                generation,
                layer,
                acceptable_layers,
                response: response_sender,
            })
            .map_err(|_| anyhow!("BLE layer session disconnected"))?;

        response_receiver
            .recv_timeout(Duration::from_secs(COMMAND_CONFIRM_TIMEOUT_SECS + 1))
            .map_err(|_| anyhow!("Timed out waiting for BLE layer confirmation"))?
            .map_err(|error| anyhow!(error))?;
        Ok(())
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
    writable: bool,
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

pub fn start_sync(
    app_handle: AppHandle,
    state: Arc<BleLayerSyncState>,
    config: BleLayerSyncConfig,
) {
    let generation = state.next_generation();
    let (command_sender, command_receiver) = mpsc::sync_channel(1);
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
            command_sender,
            command_receiver,
        )) {
            let _ = emit_status(
                &app_handle,
                &config.layout_key,
                "error",
                Some(error.to_string()),
                false,
            );
        }
        state.clear_command_session(generation);
    });
}

pub fn stop_sync(state: Arc<BleLayerSyncState>) {
    state.next_generation();
    if let Ok(mut session) = state.command_session.lock() {
        session.take();
    }
}

async fn run_sync(
    app_handle: AppHandle,
    state: Arc<BleLayerSyncState>,
    generation: u64,
    config: BleLayerSyncConfig,
    command_sender: SyncSender<LayerCommand>,
    command_receiver: Receiver<LayerCommand>,
) -> Result<()> {
    ensure_supported_format(&config)?;
    emit_status(&app_handle, &config.layout_key, "connecting", None, false)?;

    let service_uuid = Uuid::parse_str(&config.service_uuid)
        .with_context(|| format!("invalid service UUID: {}", config.service_uuid))?;
    let characteristic_uuid = Uuid::parse_str(&config.characteristic_uuid).with_context(|| {
        format!(
            "invalid characteristic UUID: {}",
            config.characteristic_uuid
        )
    })?;

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
    let writable = keyboard_supports_write(&keyboard);
    emit_status(&app_handle, &config.layout_key, "connected", None, writable)?;

    if writable {
        state.install_command_session(generation, config.layout_key.clone(), command_sender)?;
    }

    watch_layers(
        &app_handle,
        state,
        generation,
        &config.layout_key,
        keyboard,
        layer,
        command_receiver,
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
    command_receiver: Receiver<LayerCommand>,
) -> Result<()> {
    let mut pending: Option<PendingCommand> = None;
    let watch_result: Result<()> = async {
        match keyboard {
            KeyboardHandle::Btle(keyboard) => {
                let mut notifications = notification_stream(&keyboard).await?;
                while state.is_current(generation) {
                    process_command(&command_receiver, &mut pending, generation, |layer| {
                        write_btle_layer(&keyboard, layer)
                    })
                    .await;
                    expire_pending(&mut pending);
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
                    confirm_pending(&mut pending, layer);
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
                    process_command(&command_receiver, &mut pending, generation, |layer| {
                        std::future::ready(keyboard.write_active_layer(layer))
                    })
                    .await;
                    expire_pending(&mut pending);
                    if let Some(layer) = keyboard.wait_for_notification_layer_timeout(
                        Duration::from_millis(NOTIFICATION_POLL_TIMEOUT_MS),
                    )? {
                        confirm_pending(&mut pending, layer);
                        if layer != last_layer {
                            emit_layer(app_handle, layout_key, layer)?;
                            last_layer = layer;
                        }
                    }
                }
            }
        }
        Ok(())
    }
    .await;

    let failure = watch_result
        .as_ref()
        .err()
        .map(|error| error.to_string())
        .unwrap_or_else(|| "BLE layer session stopped".into());
    fail_pending(&mut pending, &failure);

    if watch_result.is_ok() {
        emit_status(app_handle, layout_key, "idle", None, false)?;
    }
    watch_result
}

fn keyboard_supports_write(handle: &KeyboardHandle) -> bool {
    match handle {
        KeyboardHandle::Btle(keyboard) => {
            supports_write_with_response(keyboard.layer_char.properties)
        }
        #[cfg(target_vendor = "apple")]
        KeyboardHandle::Macos(keyboard) => keyboard.supports_write_with_response(),
    }
}

fn supports_write_with_response(properties: CharPropFlags) -> bool {
    properties.contains(CharPropFlags::WRITE)
}

async fn process_command<F, Fut>(
    receiver: &Receiver<LayerCommand>,
    pending: &mut Option<PendingCommand>,
    generation: u64,
    write: F,
) where
    F: FnOnce(u32) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    if pending.is_some() {
        return;
    }
    let Ok(command) = receiver.try_recv() else {
        return;
    };
    if command.generation != generation {
        let _ = command
            .response
            .send(Err("BLE layer command belongs to a stale session".into()));
        return;
    }
    if let Err(error) = write(command.layer).await {
        let _ = command.response.send(Err(error.to_string()));
        return;
    }
    *pending = Some(PendingCommand {
        layer: command.layer,
        acceptable_layers: command.acceptable_layers,
        response: command.response,
        deadline: Instant::now() + Duration::from_secs(COMMAND_CONFIRM_TIMEOUT_SECS),
    });
}

fn confirm_pending(pending: &mut Option<PendingCommand>, observed_layer: u32) {
    let Some(command) = pending.take() else {
        return;
    };
    let result = if command.acceptable_layers.contains(&observed_layer) {
        Ok(())
    } else {
        Err(format!(
            "Firmware reported layer {observed_layer} while confirming requested layer {}",
            command.layer
        ))
    };
    let _ = command.response.send(result);
}

fn expire_pending(pending: &mut Option<PendingCommand>) {
    if pending
        .as_ref()
        .is_some_and(|command| Instant::now() >= command.deadline)
    {
        fail_pending(pending, "Timed out waiting for firmware layer notification");
    }
}

fn fail_pending(pending: &mut Option<PendingCommand>, message: &str) {
    if let Some(command) = pending.take() {
        let _ = command.response.send(Err(message.to_string()));
    }
}

async fn write_btle_layer(keyboard: &BtleKeyboard, layer: u32) -> Result<()> {
    if !keyboard
        .layer_char
        .properties
        .contains(CharPropFlags::WRITE)
    {
        return Err(anyhow!(
            "Layer characteristic does not support Write with response"
        ));
    }
    keyboard
        .peripheral
        .write(
            &keyboard.layer_char,
            &encode_layer(layer),
            WriteType::WithResponse,
        )
        .await
        .context("failed to write BLE layer characteristic")
}

fn encode_layer(layer: u32) -> [u8; 4] {
    layer.to_le_bytes()
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
        return Err(anyhow!(
            "Connected device does not expose the expected custom service"
        ));
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
    if !keyboard
        .layer_char
        .properties
        .contains(CharPropFlags::NOTIFY)
    {
        return Err(anyhow!(
            "Layer characteristic does not support notifications"
        ));
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
    writable: bool,
) -> Result<()> {
    app_handle
        .emit(
            "ble_layer_status",
            BleLayerStatusPayload {
                layout: layout_key.to_string(),
                state: state.to_string(),
                message,
                writable,
            },
        )
        .map_err(|error| anyhow!("failed to emit ble_layer_status: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(
        layer: u32,
        acceptable_layers: Vec<u32>,
    ) -> (Option<PendingCommand>, Receiver<Result<(), String>>) {
        let (sender, receiver) = mpsc::sync_channel(1);
        (
            Some(PendingCommand {
                layer,
                acceptable_layers,
                response: sender,
                deadline: Instant::now() + Duration::from_secs(1),
            }),
            receiver,
        )
    }

    #[test]
    fn layer_payload_is_four_byte_little_endian() {
        assert_eq!(encode_layer(0x1234_5678), [0x78, 0x56, 0x34, 0x12]);
    }

    #[test]
    fn only_write_with_response_capability_is_accepted() {
        assert!(supports_write_with_response(CharPropFlags::WRITE));
        assert!(!supports_write_with_response(
            CharPropFlags::WRITE_WITHOUT_RESPONSE
        ));
        assert!(!supports_write_with_response(CharPropFlags::READ));
    }

    #[test]
    fn matching_family_notification_confirms_command() {
        let (mut command, response) = pending(9, vec![9, 10, 12]);
        confirm_pending(&mut command, 10);
        assert_eq!(response.recv().unwrap(), Ok(()));
        assert!(command.is_none());
    }

    #[test]
    fn conflicting_notification_rejects_without_hiding_observed_truth() {
        let (mut command, response) = pending(9, vec![9, 10, 12]);
        confirm_pending(&mut command, 4);
        assert!(response
            .recv()
            .unwrap()
            .unwrap_err()
            .contains("reported layer 4"));
        assert!(command.is_none());
    }

    #[test]
    fn timeout_and_disconnect_finish_pending_command() {
        let (mut timed_out, timeout_response) = pending(9, vec![9]);
        timed_out.as_mut().unwrap().deadline = Instant::now() - Duration::from_millis(1);
        expire_pending(&mut timed_out);
        assert!(timeout_response
            .recv()
            .unwrap()
            .unwrap_err()
            .contains("Timed out"));

        let (mut disconnected, disconnect_response) = pending(9, vec![9]);
        fail_pending(&mut disconnected, "disconnected");
        assert_eq!(
            disconnect_response.recv().unwrap(),
            Err("disconnected".into())
        );
    }

    #[test]
    fn stale_or_missing_sessions_reject_commands() {
        let state = BleLayerSyncState::default();
        assert!(state.request_layer("corney", 9, vec![9]).is_err());

        let (sender, _receiver) = mpsc::sync_channel(1);
        state
            .install_command_session(0, "corney".into(), sender)
            .unwrap();
        state.next_generation();
        assert!(state.request_layer("corney", 9, vec![9]).is_err());
    }

    #[test]
    fn session_channel_serializes_commands() {
        let state = Arc::new(BleLayerSyncState::default());
        let generation = state.next_generation();
        let (sender, receiver) = mpsc::sync_channel(1);
        state
            .install_command_session(generation, "corney".into(), sender)
            .unwrap();

        let first_state = state.clone();
        let first = std::thread::spawn(move || first_state.request_layer("corney", 4, vec![4]));
        let first_command = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(first_command.layer, 4);

        let second_state = state.clone();
        let second = std::thread::spawn(move || second_state.request_layer("corney", 9, vec![9]));
        first_command.response.send(Ok(())).unwrap();
        let second_command = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(second_command.layer, 9);
        second_command.response.send(Ok(())).unwrap();

        assert!(first.join().unwrap().is_ok());
        assert!(second.join().unwrap().is_ok());
    }

    #[tokio::test]
    async fn write_rejection_finishes_command_without_pending_confirmation() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let (response_sender, response_receiver) = mpsc::sync_channel(1);
        sender
            .send(LayerCommand {
                generation: 3,
                layer: 9,
                acceptable_layers: vec![9],
                response: response_sender,
            })
            .unwrap();
        let mut pending = None;
        process_command(&receiver, &mut pending, 3, |_| async {
            Err(anyhow!("write rejected"))
        })
        .await;
        assert!(pending.is_none());
        assert_eq!(
            response_receiver.recv().unwrap(),
            Err("write rejected".into())
        );
    }
}
