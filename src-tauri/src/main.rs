// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
mod ble_layer_sync;
mod config_store;
use rdev::{listen, Event, EventType, Key};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, PredefinedMenuItem, Submenu};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct KeyboardListenerState {
    is_running: Arc<AtomicBool>,
}

#[derive(Default)]
struct BleLayerSyncTauriState {
    inner: Arc<ble_layer_sync::BleLayerSyncState>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OverlayWindowSnapshot {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    decorations: bool,
}

#[derive(Default)]
struct OverlayGeometryState {
    snapshot: Mutex<Option<OverlayWindowSnapshot>>,
}

impl OverlayGeometryState {
    fn capture_if_empty(&self, snapshot: OverlayWindowSnapshot) -> Result<(), String> {
        let mut current = self.snapshot.lock().map_err(|error| error.to_string())?;
        if current.is_none() {
            *current = Some(snapshot);
        }
        Ok(())
    }

    fn get(&self) -> Result<Option<OverlayWindowSnapshot>, String> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|error| error.to_string())
    }

    fn clear(&self) -> Result<(), String> {
        *self.snapshot.lock().map_err(|error| error.to_string())? = None;
        Ok(())
    }
}

#[derive(Serialize, Debug, Clone)]
struct KeyEventPayload {
    key: String,        // например: "KeyA", "Enter", "Unknown"
    event_type: String, // "down" или "up"
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

const TYPING_INVADERS_WINDOW_LABEL: &str = "typing-invaders";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const APP_NAME: &str = "Keyboard Helper";
const HELP_URL: &str = "https://projects.maxistar.me/keyboard_helper/setup/";
const SETTINGS_MENU_ID: &str = "app.settings";
const TOGGLE_OVERLAY_MENU_ID: &str = "view.toggle-overlay";
const ENTER_MINI_MODE_MENU_ID: &str = "view.enter-mini-mode";
const TYPING_INVADERS_MENU_ID: &str = "view.typing-invaders";
const HELP_MENU_ID: &str = "help.keyboard-helper";

fn settings_window_creation_error(error: &str) -> String {
    format!("failed to create Settings window: {error}")
}

#[derive(Debug, PartialEq, Eq)]
enum SecondaryWindowAction {
    Create,
    FocusExisting,
}

#[derive(Debug, PartialEq, Eq)]
enum OverlayVisibilityAction {
    Hide,
    ShowAndFocus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppMenuAction {
    OpenSettings,
    ToggleOverlay,
    EnterMiniMode,
    OpenTypingInvaders,
    OpenHelp,
}

impl AppMenuAction {
    fn from_menu_id(menu_id: &str) -> Option<Self> {
        match menu_id {
            SETTINGS_MENU_ID => Some(Self::OpenSettings),
            TOGGLE_OVERLAY_MENU_ID => Some(Self::ToggleOverlay),
            ENTER_MINI_MODE_MENU_ID => Some(Self::EnterMiniMode),
            TYPING_INVADERS_MENU_ID => Some(Self::OpenTypingInvaders),
            HELP_MENU_ID => Some(Self::OpenHelp),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::OpenSettings => "Settings",
            Self::ToggleOverlay => "Show/Hide Keyboard Overlay",
            Self::EnterMiniMode => "Enter Mini Mode",
            Self::OpenTypingInvaders => "Shift-Space Invaders",
            Self::OpenHelp => "Keyboard Helper Help",
        }
    }
}

trait AppMenuActionHandler {
    fn open_settings(&mut self) -> Result<(), String>;
    fn toggle_overlay(&mut self) -> Result<(), String>;
    fn enter_mini_mode(&mut self) -> Result<(), String>;
    fn open_typing_invaders(&mut self) -> Result<(), String>;
    fn open_help(&mut self) -> Result<(), String>;
}

fn dispatch_app_menu_action(menu_id: &str, handler: &mut impl AppMenuActionHandler) -> bool {
    let Some(action) = AppMenuAction::from_menu_id(menu_id) else {
        return false;
    };

    let result = match action {
        AppMenuAction::OpenSettings => handler.open_settings(),
        AppMenuAction::ToggleOverlay => handler.toggle_overlay(),
        AppMenuAction::EnterMiniMode => handler.enter_mini_mode(),
        AppMenuAction::OpenTypingInvaders => handler.open_typing_invaders(),
        AppMenuAction::OpenHelp => handler.open_help(),
    };

    if let Err(error) = result {
        eprintln!("Failed to handle {} menu action: {error}", action.label());
    }

    true
}

struct NativeAppMenuActionHandler<'a> {
    app_handle: &'a tauri::AppHandle,
}

impl AppMenuActionHandler for NativeAppMenuActionHandler<'_> {
    fn open_settings(&mut self) -> Result<(), String> {
        open_settings_window(self.app_handle)
    }

    fn toggle_overlay(&mut self) -> Result<(), String> {
        toggle_keyboard_overlay(self.app_handle)
    }

    fn enter_mini_mode(&mut self) -> Result<(), String> {
        self.app_handle
            .emit_to("overlay", "enter-mini-mode-requested", ())
            .map_err(|error| format!("failed to notify overlay: {error}"))
    }

    fn open_typing_invaders(&mut self) -> Result<(), String> {
        open_typing_invaders_window(self.app_handle)
    }

    fn open_help(&mut self) -> Result<(), String> {
        self.app_handle
            .opener()
            .open_url(HELP_URL, None::<&str>)
            .map_err(|error| format!("failed to open {HELP_URL}: {error}"))
    }
}

fn secondary_window_action(window_exists: bool) -> SecondaryWindowAction {
    if window_exists {
        SecondaryWindowAction::FocusExisting
    } else {
        SecondaryWindowAction::Create
    }
}

fn overlay_visibility_action(is_visible: bool) -> OverlayVisibilityAction {
    if is_visible {
        OverlayVisibilityAction::Hide
    } else {
        OverlayVisibilityAction::ShowAndFocus
    }
}

#[tauri::command]
fn read_config_state() -> Result<config_store::ConfigReadResult, String> {
    config_store::read_config_at(&config_store::resolve_home()?)
}

#[tauri::command]
fn save_config(
    app_handle: tauri::AppHandle,
    request: config_store::SaveConfigRequest,
) -> Result<config_store::ConfigSaveResult, String> {
    let result = config_store::save_config_at(&config_store::resolve_home()?, request)?;
    app_handle
        .emit_to("overlay", "app-settings-saved", &result)
        .map_err(|error| {
            format!("settings were saved but the overlay could not be notified: {error}")
        })?;
    Ok(result)
}

#[tauri::command]
fn read_layout_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    std::fs::read_to_string(&path_buf)
        .map_err(|e| format!("failed to read {}: {e}", path_buf.display()))
}

#[tauri::command]
fn toggle_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    toggle_keyboard_overlay(&app_handle)
}

fn toggle_keyboard_overlay(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    match overlay_visibility_action(window.is_visible().map_err(|error| error.to_string())?) {
        OverlayVisibilityAction::Hide => window.hide().map_err(|error| error.to_string()),
        OverlayVisibilityAction::ShowAndFocus => {
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())
        }
    }
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

const MINI_PADDING_LOGICAL: f64 = 24.0;
const MIN_MINI_SCALE: f64 = 0.1;

#[derive(Clone, Copy, Debug, PartialEq)]
struct GeometryRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct MiniGeometryRequest {
    content_width: f64,
    content_height: f64,
    target_scale: f64,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MiniGeometryResult {
    scale: f64,
    decorations: bool,
}

fn fit_mini_scale(
    content_width: f64,
    content_height: f64,
    target_scale: f64,
    available_width: f64,
    available_height: f64,
) -> Result<f64, String> {
    if !content_width.is_finite()
        || !content_height.is_finite()
        || content_width <= 0.0
        || content_height <= 0.0
    {
        return Err("mini content dimensions must be finite and positive".to_string());
    }
    if !target_scale.is_finite() || !(MIN_MINI_SCALE..=1.0).contains(&target_scale) {
        return Err("mini target scale must be between 0.1 and 1.0".to_string());
    }

    let width_scale = (available_width - MINI_PADDING_LOGICAL) / content_width;
    let height_scale = (available_height - MINI_PADDING_LOGICAL) / content_height;
    let fitted = target_scale.min(width_scale).min(height_scale);
    if !fitted.is_finite() || fitted < MIN_MINI_SCALE {
        return Err("the keyboard cannot fit inside the current monitor work area".to_string());
    }
    Ok(fitted)
}

fn centered_rect(source: GeometryRect, width: u32, height: u32) -> GeometryRect {
    let center_x = source.x as i64 + source.width as i64 / 2;
    let center_y = source.y as i64 + source.height as i64 / 2;
    GeometryRect {
        x: (center_x - width as i64 / 2) as i32,
        y: (center_y - height as i64 / 2) as i32,
        width,
        height,
    }
}

fn clamp_rect_to_work_area(rect: GeometryRect, work_area: GeometryRect) -> GeometryRect {
    let max_x = work_area.x as i64 + work_area.width as i64 - rect.width as i64;
    let max_y = work_area.y as i64 + work_area.height as i64 - rect.height as i64;
    GeometryRect {
        x: if rect.width >= work_area.width {
            work_area.x
        } else {
            (rect.x as i64).clamp(work_area.x as i64, max_x) as i32
        },
        y: if rect.height >= work_area.height {
            work_area.y
        } else {
            (rect.y as i64).clamp(work_area.y as i64, max_y) as i32
        },
        width: rect.width.min(work_area.width),
        height: rect.height.min(work_area.height),
    }
}

fn monitor_work_area(monitor: tauri::Monitor) -> (GeometryRect, f64) {
    let area = monitor.work_area();
    (
        GeometryRect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        monitor.scale_factor(),
    )
}

fn current_work_area(window: &WebviewWindow) -> Result<(GeometryRect, f64), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| format!("failed to resolve the current monitor: {error}"))?
        .ok_or_else(|| "current monitor is unavailable".to_string())?;
    Ok(monitor_work_area(monitor))
}

fn restore_work_area(
    window: &WebviewWindow,
    snapshot: &OverlayWindowSnapshot,
) -> Result<GeometryRect, String> {
    let center_x = snapshot.position.x as f64 + snapshot.size.width as f64 / 2.0;
    let center_y = snapshot.position.y as f64 + snapshot.size.height as f64 / 2.0;
    let saved_monitor = window
        .monitor_from_point(center_x, center_y)
        .map_err(|error| format!("failed to resolve the saved overlay monitor: {error}"))?;
    if let Some(monitor) = saved_monitor {
        return Ok(monitor_work_area(monitor).0);
    }
    current_work_area(window).map(|(area, _)| area)
}

fn apply_mini_geometry(
    window: &WebviewWindow,
    request: MiniGeometryRequest,
) -> Result<MiniGeometryResult, String> {
    let (work_area, scale_factor) = current_work_area(window)?;
    let scale = fit_mini_scale(
        request.content_width,
        request.content_height,
        request.target_scale,
        work_area.width as f64 / scale_factor,
        work_area.height as f64 / scale_factor,
    )?;
    let width = ((request.content_width * scale + MINI_PADDING_LOGICAL) * scale_factor)
        .ceil()
        .max(1.0) as u32;
    let height = ((request.content_height * scale + MINI_PADDING_LOGICAL) * scale_factor)
        .ceil()
        .max(1.0) as u32;
    let current_size = window
        .outer_size()
        .map_err(|error| format!("failed to read overlay size: {error}"))?;
    let current_position = window
        .outer_position()
        .map_err(|error| format!("failed to read overlay position: {error}"))?;
    let target = clamp_rect_to_work_area(
        centered_rect(
            GeometryRect {
                x: current_position.x,
                y: current_position.y,
                width: current_size.width,
                height: current_size.height,
            },
            width,
            height,
        ),
        work_area,
    );

    window
        .set_decorations(false)
        .map_err(|error| format!("failed to hide mini overlay decorations: {error}"))?;
    window
        .set_size(Size::Physical(PhysicalSize::new(
            target.width,
            target.height,
        )))
        .map_err(|error| format!("failed to resize mini overlay: {error}"))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            target.x, target.y,
        )))
        .map_err(|error| format!("failed to position mini overlay: {error}"))?;

    Ok(MiniGeometryResult {
        scale,
        decorations: false,
    })
}

#[tauri::command]
fn enter_mini_geometry(
    app_handle: tauri::AppHandle,
    state: State<OverlayGeometryState>,
    request: MiniGeometryRequest,
) -> Result<MiniGeometryResult, String> {
    let window = app_handle
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    state.capture_if_empty(OverlayWindowSnapshot {
        size: window
            .inner_size()
            .map_err(|error| format!("failed to capture overlay size: {error}"))?,
        position: window
            .outer_position()
            .map_err(|error| format!("failed to capture overlay position: {error}"))?,
        decorations: window
            .is_decorated()
            .map_err(|error| format!("failed to capture overlay decorations: {error}"))?,
    })?;
    apply_mini_geometry(&window, request)
}

#[tauri::command]
fn update_mini_geometry(
    app_handle: tauri::AppHandle,
    state: State<OverlayGeometryState>,
    request: MiniGeometryRequest,
) -> Result<MiniGeometryResult, String> {
    if state.get()?.is_none() {
        return Err("cannot update mini geometry before entering Mini Mode".to_string());
    }
    let window = app_handle
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    apply_mini_geometry(&window, request)
}

#[tauri::command]
fn restore_full_geometry(
    app_handle: tauri::AppHandle,
    state: State<OverlayGeometryState>,
) -> Result<MiniGeometryResult, String> {
    let Some(snapshot) = state.get()? else {
        return Ok(MiniGeometryResult {
            scale: 1.0,
            decorations: true,
        });
    };
    let window = app_handle
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    let work_area = restore_work_area(&window, &snapshot)?;
    let target = clamp_rect_to_work_area(
        GeometryRect {
            x: snapshot.position.x,
            y: snapshot.position.y,
            width: snapshot.size.width,
            height: snapshot.size.height,
        },
        work_area,
    );

    window
        .set_size(Size::Physical(PhysicalSize::new(
            target.width,
            target.height,
        )))
        .map_err(|error| format!("failed to restore overlay size: {error}"))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            target.x, target.y,
        )))
        .map_err(|error| format!("failed to restore overlay position: {error}"))?;
    window
        .set_decorations(snapshot.decorations)
        .map_err(|error| format!("failed to restore overlay decorations: {error}"))?;
    state.clear()?;

    Ok(MiniGeometryResult {
        scale: 1.0,
        decorations: snapshot.decorations,
    })
}

#[tauri::command]
fn open_typing_invaders(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_typing_invaders_window(&app_handle)
}

fn open_typing_invaders_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let existing = app_handle.get_webview_window(TYPING_INVADERS_WINDOW_LABEL);
    match secondary_window_action(existing.is_some()) {
        SecondaryWindowAction::FocusExisting => {
            let window = existing.expect("existing game window checked above");
            window.show().map_err(|error| error.to_string())?;
            if window.is_minimized().map_err(|error| error.to_string())? {
                window.unminimize().map_err(|error| error.to_string())?;
            }
            window.set_focus().map_err(|error| error.to_string())
        }
        SecondaryWindowAction::Create => {
            let window = WebviewWindowBuilder::new(
                app_handle,
                TYPING_INVADERS_WINDOW_LABEL,
                WebviewUrl::App("game.html".into()),
            )
            .title("Shift-Space Invaders")
            .inner_size(1100.0, 720.0)
            .min_inner_size(720.0, 560.0)
            .resizable(true)
            .decorations(true)
            .transparent(false)
            .always_on_top(false)
            .center()
            .build()
            .map_err(|error| format!("failed to create Shift-Space Invaders window: {error}"))?;
            window.set_focus().map_err(|error| error.to_string())
        }
    }
}

#[tauri::command]
fn open_settings(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_settings_window(&app_handle)
}

fn open_settings_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let existing = app_handle.get_webview_window(SETTINGS_WINDOW_LABEL);
    match secondary_window_action(existing.is_some()) {
        SecondaryWindowAction::FocusExisting => {
            let window = existing.expect("existing settings window checked above");
            window.show().map_err(|error| error.to_string())?;
            if window.is_minimized().map_err(|error| error.to_string())? {
                window.unminimize().map_err(|error| error.to_string())?;
            }
            window.set_focus().map_err(|error| error.to_string())
        }
        SecondaryWindowAction::Create => {
            let window = WebviewWindowBuilder::new(
                app_handle,
                SETTINGS_WINDOW_LABEL,
                WebviewUrl::App("settings.html".into()),
            )
            .title("Keyboard Helper Settings")
            .inner_size(760.0, 720.0)
            .min_inner_size(620.0, 560.0)
            .resizable(true)
            .decorations(true)
            .transparent(false)
            .always_on_top(false)
            .center()
            .build()
            .map_err(|error| settings_window_creation_error(&error.to_string()))?;
            window.set_focus().map_err(|error| error.to_string())
        }
    }
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
    let mut builder = TrayIconBuilder::new().menu(&menu).tooltip(APP_NAME);

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

#[cfg(target_os = "macos")]
fn install_macos_application_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let settings = MenuItem::with_id(
        app,
        SETTINGS_MENU_ID,
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let toggle_overlay = MenuItem::with_id(
        app,
        TOGGLE_OVERLAY_MENU_ID,
        "Show/Hide Keyboard Overlay",
        true,
        None::<&str>,
    )?;
    let enter_mini_mode = MenuItem::with_id(
        app,
        ENTER_MINI_MODE_MENU_ID,
        "Enter Mini Mode",
        true,
        None::<&str>,
    )?;
    let typing_invaders = MenuItem::with_id(
        app,
        TYPING_INVADERS_MENU_ID,
        "Shift-Space Invaders",
        true,
        None::<&str>,
    )?;
    let help = MenuItem::with_id(
        app,
        HELP_MENU_ID,
        "Keyboard Helper Help",
        true,
        None::<&str>,
    )?;

    let about_metadata = AboutMetadata {
        name: Some(APP_NAME.to_string()),
        version: Some(app.package_info().version.to_string()),
        icon: app.default_window_icon().cloned(),
        ..Default::default()
    };
    let application_menu = Submenu::with_items(
        app,
        APP_NAME,
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Keyboard Helper"), Some(about_metadata))?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide Keyboard Helper"))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit Keyboard Helper"))?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&toggle_overlay, &enter_mini_mode, &typing_invaders],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    window_menu.set_as_windows_menu_for_nsapp()?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&help])?;
    help_menu.set_as_help_menu_for_nsapp()?;

    let menu = Menu::with_items(
        app,
        &[&application_menu, &view_menu, &window_menu, &help_menu],
    )?;
    app.set_menu(menu)?;
    app.on_menu_event(|app_handle, event| {
        let mut handler = NativeAppMenuActionHandler { app_handle };
        dispatch_app_menu_action(event.id().as_ref(), &mut handler);
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.contains(&"--toggle".to_string()) {
                if let Err(error) = toggle_keyboard_overlay(app) {
                    eprintln!("Failed to handle --toggle: {error}");
                }
            }
        }))
        .manage(KeyboardListenerState::default())
        .manage(BleLayerSyncTauriState::default())
        .manage(OverlayGeometryState::default())
        .setup(|app| {
            build_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            install_macos_application_menu(app)?;
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
            toggle_window,
            set_window_decorations,
            enter_mini_geometry,
            update_mini_geometry,
            restore_full_geometry,
            open_typing_invaders,
            open_settings,
            read_config_state,
            save_config,
            read_layout_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        centered_rect, clamp_rect_to_work_area, dispatch_app_menu_action, fit_mini_scale,
        overlay_visibility_action, secondary_window_action, settings_window_creation_error,
        AppMenuAction, AppMenuActionHandler, GeometryRect, OverlayGeometryState,
        OverlayVisibilityAction, OverlayWindowSnapshot, SecondaryWindowAction,
        ENTER_MINI_MODE_MENU_ID, HELP_MENU_ID, SETTINGS_MENU_ID, TOGGLE_OVERLAY_MENU_ID,
        TYPING_INVADERS_MENU_ID,
    };
    use tauri::{PhysicalPosition, PhysicalSize};

    #[derive(Default)]
    struct FakeMenuActionHandler {
        calls: Vec<AppMenuAction>,
        fail: bool,
    }

    impl FakeMenuActionHandler {
        fn record(&mut self, action: AppMenuAction) -> Result<(), String> {
            self.calls.push(action);
            if self.fail {
                Err("simulated native action failure".to_string())
            } else {
                Ok(())
            }
        }
    }

    impl AppMenuActionHandler for FakeMenuActionHandler {
        fn open_settings(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenSettings)
        }

        fn toggle_overlay(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::ToggleOverlay)
        }

        fn enter_mini_mode(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::EnterMiniMode)
        }

        fn open_typing_invaders(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenTypingInvaders)
        }

        fn open_help(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenHelp)
        }
    }

    #[test]
    fn game_window_is_created_only_when_missing() {
        assert_eq!(
            secondary_window_action(false),
            SecondaryWindowAction::Create
        );
        assert_eq!(
            secondary_window_action(true),
            SecondaryWindowAction::FocusExisting
        );
    }

    #[test]
    fn settings_window_is_created_only_when_missing() {
        assert_eq!(
            secondary_window_action(false),
            SecondaryWindowAction::Create
        );
        assert_eq!(
            secondary_window_action(true),
            SecondaryWindowAction::FocusExisting
        );
    }

    #[test]
    fn settings_window_creation_failure_has_actionable_context() {
        assert_eq!(
            settings_window_creation_error("webview unavailable"),
            "failed to create Settings window: webview unavailable"
        );
    }

    #[test]
    fn overlay_visibility_maps_to_the_expected_toggle_behavior() {
        assert_eq!(
            overlay_visibility_action(true),
            OverlayVisibilityAction::Hide
        );
        assert_eq!(
            overlay_visibility_action(false),
            OverlayVisibilityAction::ShowAndFocus
        );
    }

    #[test]
    fn mini_scale_targets_sixty_five_percent_and_fits_the_work_area() {
        assert_eq!(fit_mini_scale(1000.0, 400.0, 0.65, 1200.0, 800.0), Ok(0.65));
        assert_eq!(fit_mini_scale(1000.0, 400.0, 0.65, 524.0, 800.0), Ok(0.5));
        assert!(fit_mini_scale(0.0, 400.0, 0.65, 1200.0, 800.0).is_err());
    }

    #[test]
    fn mini_resize_preserves_center_before_monitor_clamping() {
        let source = GeometryRect {
            x: 100,
            y: 80,
            width: 1000,
            height: 500,
        };
        assert_eq!(
            centered_rect(source, 650, 300),
            GeometryRect {
                x: 275,
                y: 180,
                width: 650,
                height: 300
            }
        );
        assert_eq!(
            clamp_rect_to_work_area(
                GeometryRect {
                    x: 900,
                    y: -40,
                    width: 500,
                    height: 300
                },
                GeometryRect {
                    x: 0,
                    y: 0,
                    width: 1200,
                    height: 800
                },
            ),
            GeometryRect {
                x: 700,
                y: 0,
                width: 500,
                height: 300
            }
        );
    }

    #[test]
    fn transient_geometry_snapshot_is_idempotent_and_cleared_only_explicitly() {
        let state = OverlayGeometryState::default();
        let first = OverlayWindowSnapshot {
            size: PhysicalSize::new(1300, 490),
            position: PhysicalPosition::new(40, 60),
            decorations: true,
        };
        let later = OverlayWindowSnapshot {
            size: PhysicalSize::new(700, 300),
            position: PhysicalPosition::new(200, 220),
            decorations: false,
        };
        state.capture_if_empty(first.clone()).unwrap();
        state.capture_if_empty(later).unwrap();
        assert_eq!(state.get().unwrap(), Some(first));
        assert!(state.get().unwrap().is_some());
        state.clear().unwrap();
        assert_eq!(state.get().unwrap(), None);
    }

    #[test]
    fn stable_custom_menu_ids_route_to_native_actions() {
        let mut handler = FakeMenuActionHandler::default();

        assert!(dispatch_app_menu_action(SETTINGS_MENU_ID, &mut handler));
        assert!(dispatch_app_menu_action(
            TOGGLE_OVERLAY_MENU_ID,
            &mut handler
        ));
        assert!(dispatch_app_menu_action(
            ENTER_MINI_MODE_MENU_ID,
            &mut handler
        ));
        assert!(dispatch_app_menu_action(
            TYPING_INVADERS_MENU_ID,
            &mut handler
        ));
        assert!(dispatch_app_menu_action(HELP_MENU_ID, &mut handler));
        assert!(!dispatch_app_menu_action("unknown", &mut handler));

        assert_eq!(
            handler.calls,
            vec![
                AppMenuAction::OpenSettings,
                AppMenuAction::ToggleOverlay,
                AppMenuAction::EnterMiniMode,
                AppMenuAction::OpenTypingInvaders,
                AppMenuAction::OpenHelp,
            ]
        );
    }

    #[test]
    fn a_failed_menu_action_does_not_block_later_actions() {
        let mut handler = FakeMenuActionHandler {
            fail: true,
            ..Default::default()
        };

        assert!(dispatch_app_menu_action(SETTINGS_MENU_ID, &mut handler));
        handler.fail = false;
        assert!(dispatch_app_menu_action(HELP_MENU_ID, &mut handler));
        assert_eq!(
            handler.calls,
            vec![AppMenuAction::OpenSettings, AppMenuAction::OpenHelp]
        );
    }
}
