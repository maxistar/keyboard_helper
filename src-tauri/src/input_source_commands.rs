use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[cfg(target_os = "macos")]
use crate::input_source_macos;
#[cfg(target_os = "windows")]
use crate::input_source_windows;
#[cfg(target_os = "linux")]
use crate::input_source_x11;

#[derive(Default)]
pub(crate) struct MacosInputSourceTauriState {
    #[cfg(target_os = "macos")]
    inner: Arc<input_source_macos::MacosInputSourceState>,
}

#[derive(Default)]
pub(crate) struct X11InputSourceTauriState {
    #[cfg(target_os = "linux")]
    inner: Arc<input_source_x11::X11InputSourceState>,
}

#[derive(Default)]
pub(crate) struct WindowsInputSourceTauriState {
    #[cfg(target_os = "windows")]
    inner: Arc<input_source_windows::WindowsInputSourceState>,
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) async fn start_windows_input_source_sync(
    app_handle: tauri::AppHandle,
    state: State<'_, WindowsInputSourceTauriState>,
    config: input_source_windows::WindowsConfig,
) -> Result<input_source_windows::WindowsSnapshot, String> {
    let inner = state.inner.clone();
    tokio::task::spawn_blocking(move || inner.start(app_handle, config))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) async fn stop_windows_input_source_sync(
    state: State<'_, WindowsInputSourceTauriState>,
) -> Result<(), String> {
    let inner = state.inner.clone();
    tokio::task::spawn_blocking(move || inner.stop())
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) async fn refresh_windows_input_source_sync(
    state: State<'_, WindowsInputSourceTauriState>,
    session: String,
) -> Result<input_source_windows::WindowsSnapshot, String> {
    let inner = state.inner.clone();
    tokio::task::spawn_blocking(move || inner.request(&session, None))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub(crate) async fn select_windows_input_source(
    state: State<'_, WindowsInputSourceTauriState>,
    source_id: String,
    session: String,
) -> Result<input_source_windows::WindowsSnapshot, String> {
    let inner = state.inner.clone();
    tokio::task::spawn_blocking(move || inner.request(&session, Some(source_id)))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MacosInputSourceSyncConfig {
    layout_key: String,
    source_ids: Vec<String>,
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) async fn start_macos_input_source_sync(
    app_handle: tauri::AppHandle,
    state: State<'_, MacosInputSourceTauriState>,
    config: MacosInputSourceSyncConfig,
) -> Result<input_source_macos::InputSourceSnapshot, String> {
    let input_source_state = state.inner.clone();
    let observer_app_handle = app_handle.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app_handle
        .run_on_main_thread(move || {
            let _ = sender.send(input_source_state.start(
                observer_app_handle,
                config.layout_key,
                config.source_ids,
            ));
        })
        .map_err(|error| format!("failed to access the macOS main thread: {error}"))?;
    receiver
        .await
        .map_err(|_| "macOS input-source bootstrap was cancelled".to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) async fn stop_macos_input_source_sync(
    app_handle: tauri::AppHandle,
    state: State<'_, MacosInputSourceTauriState>,
) -> Result<(), String> {
    let input_source_state = state.inner.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app_handle
        .run_on_main_thread(move || {
            let _ = sender.send(input_source_state.stop());
        })
        .map_err(|error| format!("failed to access the macOS main thread: {error}"))?;
    receiver
        .await
        .map_err(|_| "macOS input-source cleanup was cancelled".to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) async fn select_macos_input_source(
    app_handle: tauri::AppHandle,
    state: State<'_, MacosInputSourceTauriState>,
    source_id: String,
) -> Result<(), String> {
    let input_source_state = state.inner.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app_handle
        .run_on_main_thread(move || {
            let _ = sender.send(input_source_state.select(&source_id));
        })
        .map_err(|error| format!("failed to access the macOS main thread: {error}"))?;
    receiver
        .await
        .map_err(|_| "macOS input-source selection was cancelled".to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) async fn refresh_macos_input_source_sync(
    app_handle: tauri::AppHandle,
    state: State<'_, MacosInputSourceTauriState>,
) -> Result<input_source_macos::InputSourceSnapshot, String> {
    let input_source_state = state.inner.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app_handle
        .run_on_main_thread(move || {
            let _ = sender.send(input_source_state.snapshot());
        })
        .map_err(|error| format!("failed to access the macOS main thread: {error}"))?;
    receiver
        .await
        .map_err(|_| "macOS input-source refresh was cancelled".to_string())?
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn start_x11_input_source_sync(
    app_handle: tauri::AppHandle,
    state: State<'_, X11InputSourceTauriState>,
    config: input_source_x11::X11InputSourceSyncConfig,
) -> Result<input_source_x11::X11InputSourceSnapshot, input_source_x11::X11InputSourceError> {
    let input_source_state = state.inner.clone();
    let result = tokio::task::spawn_blocking(move || input_source_state.start(app_handle, config))
        .await
        .map_err(|error| input_source_x11::X11InputSourceError {
            reason: "startup-cancelled".into(),
            message: error.to_string(),
            diagnostics: None,
        })?;
    if let Err(error) = &result {
        eprintln!(
            "X11 input-source sync failed to start: {} ({})",
            error.message, error.reason
        );
    }
    result
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn stop_x11_input_source_sync(
    state: State<'_, X11InputSourceTauriState>,
) -> Result<(), input_source_x11::X11InputSourceError> {
    let input_source_state = state.inner.clone();
    tokio::task::spawn_blocking(move || input_source_state.stop())
        .await
        .map_err(|error| input_source_x11::X11InputSourceError {
            reason: "stop-cancelled".into(),
            message: error.to_string(),
            diagnostics: None,
        })?
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn refresh_x11_input_source_sync(
    state: State<'_, X11InputSourceTauriState>,
) -> Result<input_source_x11::X11InputSourceSnapshot, input_source_x11::X11InputSourceError> {
    let input_source_state = state.inner.clone();
    tokio::task::spawn_blocking(move || input_source_state.refresh())
        .await
        .map_err(|error| input_source_x11::X11InputSourceError {
            reason: "refresh-cancelled".into(),
            message: error.to_string(),
            diagnostics: None,
        })?
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn select_x11_input_source(
    state: State<'_, X11InputSourceTauriState>,
    source_id: String,
) -> Result<(), input_source_x11::X11InputSourceError> {
    let input_source_state = state.inner.clone();
    tokio::task::spawn_blocking(move || input_source_state.select(&source_id))
        .await
        .map_err(|error| input_source_x11::X11InputSourceError {
            reason: "selection-cancelled".into(),
            message: error.to_string(),
            diagnostics: None,
        })?
}
