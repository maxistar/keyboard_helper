// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::path::PathBuf;
mod ble_layer_sync;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};
use rdev::{listen, Event, EventType, Key};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug, Clone)]


#[derive(Default)]
struct KeyboardListenerState {
    is_running: Arc<AtomicBool>,
}

#[derive(Default)]
struct BleLayerSyncTauriState {
    inner: Arc<ble_layer_sync::BleLayerSyncState>,
}

#[derive(Serialize, Debug, Clone)]
struct KeyEventPayload {
    key: String,       // например: "KeyA", "Enter", "Unknown"
    event_type: String // "down" или "up"
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct BleLayerSyncConfig {
    layout_key: String,
    device_name: Option<String>,
    service_uuid: String,
    characteristic_uuid: String,
    format: String,
}

#[tauri::command]
fn read_config_file() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| format!("cannot resolve home directory: {e}"))?;
    let primary = PathBuf::from(&home).join(".keyri.json");
    let fallback = PathBuf::from(&home).join("keyri.json");

    std::fs::read_to_string(&primary)
        .or_else(|_| std::fs::read_to_string(&fallback))
        .map_err(|e| {
            format!(
                "failed to read {} or {}: {e}",
                primary.display(),
                fallback.display()
            )
        })
}

#[tauri::command]
fn read_layout_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    std::fs::read_to_string(&path_buf)
        .map_err(|e| format!("failed to read {}: {e}", path_buf.display()))
}

#[tauri::command]
fn set_window_decorations(app_handle: tauri::AppHandle, decorations: bool) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;

    window
        .set_decorations(decorations)
        .map_err(|e| format!("failed to set decorations: {e}"))
}

#[tauri::command]
fn start_keyboard_listener(app_handle: tauri::AppHandle, state: State<KeyboardListenerState>) {
    // Если уже запущен — второй раз не стартуем
    if state.is_running.swap(true, Ordering::SeqCst) {
        println!("Keyboard listener already running");
        return;
    }

    // Копия handle для потока
    let app_handle = app_handle.clone();
    // Отдельная копия флага, чтобы сбросить его после остановки слушателя
    let running_flag = state.is_running.clone();

    std::thread::spawn(move || {
        println!("Starting global keyboard listener…");

        // Функция, которая будет вызываться на каждое событие
        let callback = move |event: Event| {
            if let Some(payload) = convert_event(event) {
                // Шлём во все окна Tauri событие "key_event"
                if let Err(err) = app_handle.emit("key_event", payload) {
                    eprintln!("Failed to emit key_event: {:?}", err);
                }
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("Error from rdev::listen: {:?}", error);
        }

        // Позволяем повторно запускать после остановки/ошибки
        running_flag.store(false, Ordering::SeqCst);
        println!("Keyboard listener stopped");
    });
}

#[tauri::command]
fn start_ble_layer_sync(
    app_handle: tauri::AppHandle,
    state: State<BleLayerSyncTauriState>,
    config: BleLayerSyncConfig,
) -> Result<(), String> {
    ble_layer_sync::start_sync(
        app_handle,
        state.inner.clone(),
        ble_layer_sync::BleLayerSyncConfig {
            layout_key: config.layout_key,
            device_name: config.device_name,
            service_uuid: config.service_uuid,
            characteristic_uuid: config.characteristic_uuid,
            format: config.format,
        },
    );
    Ok(())
}

#[tauri::command]
fn stop_ble_layer_sync(state: State<BleLayerSyncTauriState>) {
    ble_layer_sync::stop_sync(state.inner.clone());
}

/// Преобразуем rdev::Event в удобный для фронта формат
fn convert_event(ev: Event) -> Option<KeyEventPayload> {
    
    //if let Some(name) = ev.name.as_deref() {
    //    if name == "F24" {
    //        println!("F24 key event found");
    //    }
    //}

    match ev.event_type {
        EventType::KeyPress(key) => Some(KeyEventPayload {
            key: key_to_string(key),
            event_type: "down".into(),
        }),
        EventType::KeyRelease(key) => Some(KeyEventPayload {
            key: key_to_string(key),
            event_type: "up".into(),
        }),
        _other => {
            // Helpful to see which events are not being handled (e.g., mouse or media keys)
            // eprintln!("Ignoring non-key event: {:?}", other);
            None
        }
    }
}

fn key_to_string(key: Key) -> String {
    // Use the rdev key variant name directly so the frontend can see every key
    // even if we haven't mapped it manually.
    format!("{:?}", key)
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let restore = MenuItem::with_id(app, "restore", "Restore", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&restore, &quit])?;
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Keyboard Layout");

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "restore" => {
                if let Some(window) = app.get_webview_window("overlay") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.contains(&"--toggle".to_string()) {
                if let Some(window) = app.get_webview_window("overlay") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        }))
        .manage(KeyboardListenerState::default())
        .manage(BleLayerSyncTauriState::default())
        .setup(|app| {
            build_tray(app.handle())?;
            if let Some(window) = app.get_webview_window("overlay") {
                let window_handle = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_handle.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_keyboard_listener,
            start_ble_layer_sync,
            stop_ble_layer_sync,
            set_window_decorations,
            read_config_file,
            read_layout_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
