// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_coaching;
mod app_menu;
mod ble_commands;
mod ble_keyboard_events;
mod ble_layer_sync;
mod config_commands;
mod config_store;
mod input_source_commands;
#[cfg(target_os = "macos")]
mod input_source_macos;
#[cfg(target_os = "windows")]
mod input_source_windows;
#[cfg(target_os = "linux")]
mod input_source_x11;
mod keyboard_listener;
mod mini_geometry;
mod native_constants;
mod native_shell;
mod secondary_windows;
mod typing_analytics;

use tauri::Manager;

fn main() {
    if std::env::args().any(|argument| argument == "mcp") {
        if let Err(error) = ai_coaching::run_mcp_stdio() {
            eprintln!("Keyboard Helper MCP server failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.contains(&"--toggle".to_string()) {
                if let Err(error) = mini_geometry::toggle_keyboard_overlay(app) {
                    eprintln!("Failed to handle --toggle: {error}");
                }
            }
        }))
        .manage(keyboard_listener::KeyboardListenerState::default())
        .manage(ble_commands::BleLayerSyncTauriState::default())
        .manage(input_source_commands::MacosInputSourceTauriState::default())
        .manage(input_source_commands::X11InputSourceTauriState::default())
        .manage(input_source_commands::WindowsInputSourceTauriState::default())
        .manage(mini_geometry::OverlayGeometryState::default())
        .manage(secondary_windows::SecondaryWindowReadinessState::default())
        .manage(typing_analytics::TypingAnalyticsState::default())
        .setup(|app| {
            typing_analytics::initialize_app(
                app.handle(),
                &app.state::<typing_analytics::TypingAnalyticsState>(),
            )?;
            native_shell::build_tray(app.handle())?;
            #[cfg(target_os = "macos")]
            native_shell::install_macos_application_menu(app)?;
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
            keyboard_listener::start_keyboard_listener,
            ble_commands::start_ble_layer_sync,
            ble_commands::stop_ble_layer_sync,
            ble_commands::write_ble_layer,
            #[cfg(target_os = "macos")]
            input_source_commands::start_macos_input_source_sync,
            #[cfg(target_os = "macos")]
            input_source_commands::stop_macos_input_source_sync,
            #[cfg(target_os = "macos")]
            input_source_commands::select_macos_input_source,
            #[cfg(target_os = "macos")]
            input_source_commands::refresh_macos_input_source_sync,
            #[cfg(target_os = "linux")]
            input_source_commands::start_x11_input_source_sync,
            #[cfg(target_os = "linux")]
            input_source_commands::stop_x11_input_source_sync,
            #[cfg(target_os = "linux")]
            input_source_commands::select_x11_input_source,
            #[cfg(target_os = "linux")]
            input_source_commands::refresh_x11_input_source_sync,
            #[cfg(target_os = "windows")]
            input_source_commands::start_windows_input_source_sync,
            #[cfg(target_os = "windows")]
            input_source_commands::stop_windows_input_source_sync,
            #[cfg(target_os = "windows")]
            input_source_commands::refresh_windows_input_source_sync,
            #[cfg(target_os = "windows")]
            input_source_commands::select_windows_input_source,
            mini_geometry::toggle_window,
            mini_geometry::set_window_decorations,
            mini_geometry::enter_mini_geometry,
            mini_geometry::update_mini_geometry,
            mini_geometry::restore_full_geometry,
            secondary_windows::open_typing_invaders,
            secondary_windows::open_keyboard_snake,
            secondary_windows::open_flappy_key_bird,
            secondary_windows::open_underwater_typing_fishing,
            secondary_windows::open_typing_insights,
            secondary_windows::open_settings,
            secondary_windows::open_keyboard_self_test,
            secondary_windows::secondary_window_ready,
            typing_analytics::record_typing_analytics,
            typing_analytics::read_typing_analytics,
            typing_analytics::delete_typing_analytics,
            typing_analytics::typing_analytics_storage_info,
            ai_coaching::approve_ai_coaching_report,
            ai_coaching::revoke_ai_coaching_report,
            ai_coaching::read_ai_coaching_status,
            ai_coaching::read_ai_coaching_recommendations,
            secondary_windows::quality_smoke_requested,
            secondary_windows::run_secondary_window_smoke,
            config_commands::read_config_state,
            config_commands::save_config,
            config_commands::read_layout_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
