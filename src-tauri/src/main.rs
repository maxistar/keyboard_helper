// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, State,
};
use rdev::{listen, Event, EventType, Key};
use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
struct LayoutSelectPayload {
    layout: String,
}

#[derive(Default)]
struct KeyboardListenerState {
    is_running: Arc<AtomicBool>,
}

#[derive(Serialize, Debug, Clone)]
struct KeyEventPayload {
    key: String,       // например: "KeyA", "Enter", "Unknown"
    event_type: String // "down" или "up"
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
        other => {
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


fn main() {
    tauri::Builder::default()
        .manage(KeyboardListenerState::default())
        .menu(|app| {
            let about_item = MenuItemBuilder::with_id("about", "About").build(app)?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(
                    &CheckMenuItemBuilder::with_id("layout-qwerty", "Qwerty")
                        .checked(false)
                        .build(app)?,
                )
                .item(
                    &CheckMenuItemBuilder::with_id("layout-corne", "Corney")
                        .checked(true)
                        .build(app)?,
                )
                .item(
                    &CheckMenuItemBuilder::with_id("layout-dactyl", "Dactyl Manuform")
                        .checked(false)
                        .build(app)?,
                )
                .build()?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&about_item)
                .build()?;
            MenuBuilder::new(app)
                .item(&view_menu)
                .item(&help_menu)
                .build()
        })
        .on_menu_event(|app, event| {
            if event.id() == "about" {
                if let Some(window) = app.get_webview_window("overlay") {
                    let _ = window.eval(
                        "alert('Keyboard listener capturing global keys (including F13–F24).');",
                    );
                }
            } else {
                match event.id().as_ref() {
                    "layout-qwerty" => set_active_layout(app, "qwerty"),
                    "layout-corne" => set_active_layout(app, "corne"),
                    "layout-dactyl" => set_active_layout(app, "dactyl"),
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_keyboard_listener,
            set_window_decorations,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn set_active_layout(app: &AppHandle, layout: &str) {
    if let Some(menu) = app.menu() {
        for (id, key) in [
            ("layout-qwerty", "qwerty"),
            ("layout-corne", "corne"),
            ("layout-dactyl", "dactyl"),
        ] {
            let _ = menu.get(id).and_then(|item| {
                if let tauri::menu::MenuItemKind::Check(check) = item {
                    check.set_checked(layout == key).ok()
                } else {
                    None
                }
            });
        }
    }

    let _ = app.emit(
        "layout_selected",
        LayoutSelectPayload {
            layout: layout.to_string(),
        },
    );
}
