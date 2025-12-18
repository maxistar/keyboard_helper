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
        _ => None,
    }
}

fn key_to_string(key: Key) -> String {
    match key {
        Key::KeyA => "KeyA",
        Key::KeyB => "KeyB",
        Key::KeyC => "KeyC",
        Key::KeyD => "KeyD",
        Key::KeyE => "KeyE",
        Key::KeyF => "KeyF",
        Key::KeyG => "KeyG",
        Key::KeyH => "KeyH",
        Key::KeyI => "KeyI",
        Key::KeyJ => "KeyJ",
        Key::KeyK => "KeyK",
        Key::KeyL => "KeyL",
        Key::KeyM => "KeyM",
        Key::KeyN => "KeyN",
        Key::KeyO => "KeyO",
        Key::KeyP => "KeyP",
        Key::KeyQ => "KeyQ",
        Key::KeyR => "KeyR",
        Key::KeyS => "KeyS",
        Key::KeyT => "KeyT",
        Key::KeyU => "KeyU",
        Key::KeyV => "KeyV",
        Key::KeyW => "KeyW",
        Key::KeyX => "KeyX",
        Key::KeyY => "KeyY",
        Key::KeyZ => "KeyZ",

        Key::Num0 => "Digit0",
        Key::Num1 => "Digit1",
        Key::Num2 => "Digit2",
        Key::Num3 => "Digit3",
        Key::Num4 => "Digit4",
        Key::Num5 => "Digit5",
        Key::Num6 => "Digit6",
        Key::Num7 => "Digit7",
        Key::Num8 => "Digit8",
        Key::Num9 => "Digit9",

        Key::F1 => "F1",
        Key::F2 => "F2",
        Key::F3 => "F3",
        Key::F4 => "F4",
        Key::F5 => "F5",
        Key::F6 => "F6",
        Key::F7 => "F7",
        Key::F8 => "F8",
        Key::F9 => "F9",
        Key::F10 => "F10",
        Key::F11 => "F11",
        Key::F12 => "F12",
        Key::F13 => "F13",
        Key::F14 => "F14",
        Key::F15 => "F15",
        Key::F16 => "F16",
        Key::F17 => "F17",
        Key::F18 => "F18",
        Key::F19 => "F19",
        Key::F20 => "F20",
        Key::F21 => "F21",
        Key::F22 => "F22",
        Key::F23 => "F23",
        Key::F24 => "F24",  

        Key::Return => "Enter",
        Key::Space => "Space",
        Key::Tab => "Tab",
        Key::Backspace => "Backspace",
        Key::Escape => "Escape",
        Key::ShiftLeft => "ShiftLeft",
        Key::ShiftRight => "ShiftRight",
        Key::ControlLeft => "ControlLeft",
        Key::ControlRight => "ControlRight",
        Key::Alt => "Alt",
        Key::AltGr => "AltGr",
        Key::CapsLock => "CapsLock",

        _ => "Unknown",
    }
    .to_string()
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
