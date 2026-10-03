use crate::native_constants::*;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecondaryWindowReadyPayload {
    label: String,
    state: String,
    stage: String,
    error: Option<String>,
}

pub(crate) struct SecondaryWindowReadinessState {
    sender: tokio::sync::broadcast::Sender<SecondaryWindowReadyPayload>,
}

impl Default for SecondaryWindowReadinessState {
    fn default() -> Self {
        let (sender, _) = tokio::sync::broadcast::channel(16);
        Self { sender }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecondaryWindowSmokeResult {
    label: String,
    ready: bool,
    visible: bool,
    reused: bool,
    restored: bool,
    focused: bool,
    closed: bool,
    stage: String,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QualitySmokeReport {
    schema_version: u8,
    platform: String,
    passed: bool,
    windows: Vec<SecondaryWindowSmokeResult>,
}

struct SecondaryWindowDescriptor {
    label: &'static str,
    url: &'static str,
    title: &'static str,
    inner_size: (f64, f64),
    min_inner_size: (f64, f64),
    resizable: bool,
    decorations: bool,
    transparent: bool,
    always_on_top: bool,
    creation_error_name: &'static str,
}

const TYPING_INSIGHTS_WINDOW: SecondaryWindowDescriptor = SecondaryWindowDescriptor {
    label: TYPING_INSIGHTS_WINDOW_LABEL,
    url: "typing-insights.html",
    title: "Typing Insights",
    inner_size: (1120.0, 820.0),
    min_inner_size: (680.0, 520.0),
    resizable: true,
    decorations: true,
    transparent: false,
    always_on_top: false,
    creation_error_name: "Typing Insights",
};

const KEYBOARD_SNAKE_WINDOW: SecondaryWindowDescriptor = SecondaryWindowDescriptor {
    label: KEYBOARD_SNAKE_WINDOW_LABEL,
    url: "keyboard-snake.html",
    title: "Keyboard Snake",
    inner_size: (900.0, 760.0),
    min_inner_size: (560.0, 520.0),
    resizable: true,
    decorations: true,
    transparent: false,
    always_on_top: false,
    creation_error_name: "Keyboard Snake",
};

const FLAPPY_KEY_BIRD_WINDOW: SecondaryWindowDescriptor = SecondaryWindowDescriptor {
    label: FLAPPY_KEY_BIRD_WINDOW_LABEL,
    url: "flappy-key-bird.html",
    title: "Flappy Key-Bird",
    inner_size: (1000.0, 760.0),
    min_inner_size: (620.0, 540.0),
    resizable: true,
    decorations: true,
    transparent: false,
    always_on_top: false,
    creation_error_name: "Flappy Key-Bird",
};

const UNDERWATER_TYPING_FISHING_WINDOW: SecondaryWindowDescriptor = SecondaryWindowDescriptor {
    label: UNDERWATER_TYPING_FISHING_WINDOW_LABEL,
    url: "underwater-typing-fishing.html",
    title: "Underwater Typing Fishing",
    inner_size: (1100.0, 780.0),
    min_inner_size: (640.0, 560.0),
    resizable: true,
    decorations: true,
    transparent: false,
    always_on_top: false,
    creation_error_name: "Underwater Typing Fishing",
};

const TYPING_INVADERS_WINDOW: SecondaryWindowDescriptor = SecondaryWindowDescriptor {
    label: TYPING_INVADERS_WINDOW_LABEL,
    url: "game.html",
    title: "Shift-Space Invaders",
    inner_size: (1100.0, 720.0),
    min_inner_size: (720.0, 560.0),
    resizable: true,
    decorations: true,
    transparent: false,
    always_on_top: false,
    creation_error_name: "Shift-Space Invaders",
};

const SETTINGS_WINDOW: SecondaryWindowDescriptor = SecondaryWindowDescriptor {
    label: SETTINGS_WINDOW_LABEL,
    url: "settings.html",
    title: "Keyboard Helper Settings",
    inner_size: (760.0, 720.0),
    min_inner_size: (620.0, 560.0),
    resizable: true,
    decorations: true,
    transparent: false,
    always_on_top: false,
    creation_error_name: "Settings",
};

const KEYBOARD_SELF_TEST_WINDOW: SecondaryWindowDescriptor = SecondaryWindowDescriptor {
    label: KEYBOARD_SELF_TEST_WINDOW_LABEL,
    url: "self-test.html?layout={layout}",
    title: "Keyboard Self-test",
    inner_size: (680.0, 720.0),
    min_inner_size: (500.0, 520.0),
    resizable: true,
    decorations: true,
    transparent: false,
    always_on_top: false,
    creation_error_name: "Keyboard Self-test",
};

const SECONDARY_WINDOWS: [SecondaryWindowDescriptor; 7] = [
    SETTINGS_WINDOW,
    TYPING_INVADERS_WINDOW,
    KEYBOARD_SNAKE_WINDOW,
    FLAPPY_KEY_BIRD_WINDOW,
    UNDERWATER_TYPING_FISHING_WINDOW,
    KEYBOARD_SELF_TEST_WINDOW,
    TYPING_INSIGHTS_WINDOW,
];

fn secondary_window_creation_error(descriptor: &SecondaryWindowDescriptor, error: &str) -> String {
    format!(
        "failed to create {} window: {error}",
        descriptor.creation_error_name
    )
}

#[derive(Debug, PartialEq, Eq)]
enum SecondaryWindowAction {
    Create,
    FocusExisting,
}

#[derive(Debug, PartialEq, Eq)]
enum SecondaryWindowOpenResult {
    Created,
    FocusedExisting,
}

fn secondary_window_action(window_exists: bool) -> SecondaryWindowAction {
    if window_exists {
        SecondaryWindowAction::FocusExisting
    } else {
        SecondaryWindowAction::Create
    }
}

fn secondary_window_descriptor(label: &str) -> Option<&'static SecondaryWindowDescriptor> {
    SECONDARY_WINDOWS
        .iter()
        .find(|descriptor| descriptor.label == label)
}

fn open_or_focus_secondary_window(
    app_handle: &tauri::AppHandle,
    descriptor: &SecondaryWindowDescriptor,
    url: String,
) -> Result<SecondaryWindowOpenResult, String> {
    let existing = app_handle.get_webview_window(descriptor.label);
    match secondary_window_action(existing.is_some()) {
        SecondaryWindowAction::FocusExisting => {
            let window = existing.expect("existing secondary window checked above");
            window.show().map_err(|error| error.to_string())?;
            if window.is_minimized().map_err(|error| error.to_string())? {
                window.unminimize().map_err(|error| error.to_string())?;
            }
            window.set_focus().map_err(|error| error.to_string())?;
            Ok(SecondaryWindowOpenResult::FocusedExisting)
        }
        SecondaryWindowAction::Create => {
            let window = WebviewWindowBuilder::new(
                app_handle,
                descriptor.label,
                WebviewUrl::App(url.into()),
            )
            .title(descriptor.title)
            .inner_size(descriptor.inner_size.0, descriptor.inner_size.1)
            .min_inner_size(descriptor.min_inner_size.0, descriptor.min_inner_size.1)
            .resizable(descriptor.resizable)
            .decorations(descriptor.decorations)
            .transparent(descriptor.transparent)
            .always_on_top(descriptor.always_on_top)
            .center()
            .build()
            .map_err(|error| secondary_window_creation_error(descriptor, &error.to_string()))?;
            window.set_focus().map_err(|error| error.to_string())?;
            Ok(SecondaryWindowOpenResult::Created)
        }
    }
}

fn open_registered_secondary_window(
    app_handle: &tauri::AppHandle,
    descriptor: &SecondaryWindowDescriptor,
) -> Result<SecondaryWindowOpenResult, String> {
    open_or_focus_secondary_window(app_handle, descriptor, descriptor.url.to_string())
}

fn self_test_url(current_layout: &str) -> String {
    let safe_layout: String = current_layout
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect();
    format!("self-test.html?layout={safe_layout}")
}

#[tauri::command]
pub(crate) async fn open_typing_invaders(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_typing_invaders_window(&app_handle)
}

#[tauri::command]
pub(crate) async fn open_keyboard_snake(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_keyboard_snake_window(&app_handle)
}

#[tauri::command]
pub(crate) async fn open_flappy_key_bird(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_flappy_key_bird_window(&app_handle)
}

#[tauri::command]
pub(crate) async fn open_underwater_typing_fishing(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    open_underwater_typing_fishing_window(&app_handle)
}

#[tauri::command]
pub(crate) async fn open_typing_insights(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_typing_insights_window(&app_handle)
}

pub(crate) fn open_typing_insights_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    open_registered_secondary_window(app_handle, &TYPING_INSIGHTS_WINDOW).map(|_| ())
}

pub(crate) fn open_keyboard_snake_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    open_registered_secondary_window(app_handle, &KEYBOARD_SNAKE_WINDOW).map(|_| ())
}

pub(crate) fn open_flappy_key_bird_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    open_registered_secondary_window(app_handle, &FLAPPY_KEY_BIRD_WINDOW).map(|_| ())
}

pub(crate) fn open_underwater_typing_fishing_window(
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    open_registered_secondary_window(app_handle, &UNDERWATER_TYPING_FISHING_WINDOW).map(|_| ())
}

pub(crate) fn open_typing_invaders_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    open_registered_secondary_window(app_handle, &TYPING_INVADERS_WINDOW).map(|_| ())
}

#[tauri::command]
pub(crate) async fn open_settings(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_settings_window(&app_handle)
}

pub(crate) fn open_settings_window(app_handle: &tauri::AppHandle) -> Result<(), String> {
    open_registered_secondary_window(app_handle, &SETTINGS_WINDOW).map(|_| ())
}

#[tauri::command]
pub(crate) async fn open_keyboard_self_test(
    app_handle: tauri::AppHandle,
    current_layout: String,
) -> Result<(), String> {
    open_keyboard_self_test_window(&app_handle, &current_layout)
}

fn open_keyboard_self_test_window(
    app_handle: &tauri::AppHandle,
    current_layout: &str,
) -> Result<(), String> {
    let result = open_or_focus_secondary_window(
        app_handle,
        &KEYBOARD_SELF_TEST_WINDOW,
        self_test_url(current_layout),
    )?;
    if result == SecondaryWindowOpenResult::Created {
        if let Some(window) = app_handle.get_webview_window(KEYBOARD_SELF_TEST_WINDOW_LABEL) {
            let cleanup_handle = app_handle.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    let _ = cleanup_handle.emit_to(
                        "overlay",
                        "self-test-overlay-state",
                        serde_json::json!({ "active": false, "states": {} }),
                    );
                }
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn secondary_window_ready(
    state: State<SecondaryWindowReadinessState>,
    payload: SecondaryWindowReadyPayload,
) {
    let _ = state.sender.send(payload);
}

#[tauri::command]
pub(crate) fn quality_smoke_requested() -> bool {
    std::env::args().any(|argument| argument == "--quality-smoke-secondary-windows")
}

async fn wait_for_secondary_window(
    receiver: &mut tokio::sync::broadcast::Receiver<SecondaryWindowReadyPayload>,
    label: &str,
) -> Result<(), SecondaryWindowReadyPayload> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(SecondaryWindowReadyPayload {
                label: label.to_string(),
                state: "failed".to_string(),
                stage: "timeout".to_string(),
                error: Some(format!("{label} readiness timed out")),
            });
        }
        let payload = tokio::time::timeout(remaining, receiver.recv())
            .await
            .map_err(|_| SecondaryWindowReadyPayload {
                label: label.to_string(),
                state: "failed".to_string(),
                stage: "timeout".to_string(),
                error: Some(format!("{label} readiness timed out")),
            })?
            .map_err(|error| SecondaryWindowReadyPayload {
                label: label.to_string(),
                state: "failed".to_string(),
                stage: "readiness".to_string(),
                error: Some(format!("{label} readiness channel failed: {error}")),
            })?;
        if payload.label != label {
            continue;
        }
        return if payload.state == "ready" {
            Ok(())
        } else {
            Err(payload)
        };
    }
}

async fn open_secondary_window_for_smoke(
    app_handle: &tauri::AppHandle,
    label: &str,
) -> Result<(), String> {
    let descriptor = secondary_window_descriptor(label)
        .ok_or_else(|| format!("unknown secondary window label: {label}"))?;
    match descriptor.label {
        SETTINGS_WINDOW_LABEL => open_settings(app_handle.clone()).await,
        TYPING_INVADERS_WINDOW_LABEL => open_typing_invaders(app_handle.clone()).await,
        KEYBOARD_SNAKE_WINDOW_LABEL => open_keyboard_snake(app_handle.clone()).await,
        FLAPPY_KEY_BIRD_WINDOW_LABEL => open_flappy_key_bird(app_handle.clone()).await,
        UNDERWATER_TYPING_FISHING_WINDOW_LABEL => {
            open_underwater_typing_fishing(app_handle.clone()).await
        }
        TYPING_INSIGHTS_WINDOW_LABEL => open_typing_insights(app_handle.clone()).await,
        KEYBOARD_SELF_TEST_WINDOW_LABEL => {
            open_keyboard_self_test(app_handle.clone(), "qwerty".to_string()).await
        }
        _ => Err(format!(
            "registered secondary window has no opener: {label}"
        )),
    }
}

async fn smoke_secondary_window(
    app_handle: &tauri::AppHandle,
    receiver: &mut tokio::sync::broadcast::Receiver<SecondaryWindowReadyPayload>,
    label: &str,
) -> SecondaryWindowSmokeResult {
    let mut result = SecondaryWindowSmokeResult {
        label: label.to_string(),
        ready: false,
        visible: false,
        reused: false,
        restored: false,
        focused: false,
        closed: false,
        stage: "open".to_string(),
        error: None,
    };
    let opened = open_secondary_window_for_smoke(app_handle, label).await;
    if let Err(error) = opened {
        result.error = Some(error);
        return result;
    }

    result.stage = "readiness".to_string();
    if let Err(failure) = wait_for_secondary_window(receiver, label).await {
        result.stage = failure.stage;
        result.error = Some(
            failure
                .error
                .unwrap_or_else(|| format!("{label} readiness failed")),
        );
        if let Some(window) = app_handle.get_webview_window(label) {
            let _ = window.destroy();
        }
        return result;
    }
    result.ready = true;
    let Some(window) = app_handle.get_webview_window(label) else {
        result.error = Some(format!("{label} disappeared after readiness"));
        return result;
    };
    result.stage = "visible".to_string();
    result.visible = window.is_visible().unwrap_or(false);
    if !result.visible {
        result.error = Some(format!("{label} is not visible"));
        let _ = window.destroy();
        return result;
    }

    result.stage = "reuse".to_string();
    let reused = open_secondary_window_for_smoke(app_handle, label).await;
    result.reused = reused.is_ok() && app_handle.get_webview_window(label).is_some();
    if !result.reused {
        result.error = Some(
            reused
                .err()
                .unwrap_or_else(|| format!("{label} was not reused")),
        );
        let _ = window.destroy();
        return result;
    }

    result.stage = "restore".to_string();
    if let Err(error) = window.minimize() {
        result.error = Some(format!("failed to minimize {label}: {error}"));
        let _ = window.destroy();
        return result;
    }
    let restored = open_secondary_window_for_smoke(app_handle, label).await;
    for _ in 0..20 {
        result.restored = restored.is_ok() && !window.is_minimized().unwrap_or(true);
        result.focused = window.is_focused().unwrap_or(false);
        if result.restored && result.focused {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if !result.restored || !result.focused {
        result.stage = "focus".to_string();
        result.error = Some(format!("{label} did not restore and focus"));
    }
    if result.error.is_none() {
        result.stage = "close".to_string();
    }
    if let Err(error) = window.destroy() {
        result.error = Some(format!("failed to close {label}: {error}"));
        return result;
    }
    for _ in 0..20 {
        if app_handle.get_webview_window(label).is_none() {
            result.closed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if !result.closed {
        result.error = Some(format!("{label} did not close cleanly"));
    } else if result.error.is_none() {
        result.stage = "complete".to_string();
    }
    result
}

#[tauri::command]
pub(crate) async fn run_secondary_window_smoke(
    app_handle: tauri::AppHandle,
) -> Result<QualitySmokeReport, String> {
    let sender = app_handle
        .state::<SecondaryWindowReadinessState>()
        .sender
        .clone();
    let mut receiver = sender.subscribe();
    let mut windows = Vec::new();
    for descriptor in SECONDARY_WINDOWS {
        windows.push(smoke_secondary_window(&app_handle, &mut receiver, descriptor.label).await);
    }
    let passed = windows.iter().all(|result| result.error.is_none());
    let report = QualitySmokeReport {
        schema_version: 1,
        platform: std::env::consts::OS.to_string(),
        passed,
        windows,
    };
    if let Ok(path) = std::env::var("KEYBOARD_HELPER_SMOKE_REPORT") {
        if let Ok(json) = serde_json::to_string_pretty(&report) {
            let _ = std::fs::write(path, json);
        }
    }
    let exit_handle = app_handle.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(250)).await;
        exit_handle.exit(if passed { 0 } else { 1 });
    });
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::{
        secondary_window_action, secondary_window_creation_error, secondary_window_descriptor,
        self_test_url, SecondaryWindowAction, KEYBOARD_SELF_TEST_WINDOW, SECONDARY_WINDOWS,
    };
    use crate::native_constants::{
        KEYBOARD_SELF_TEST_WINDOW_LABEL, KEYBOARD_SNAKE_WINDOW_LABEL, SETTINGS_WINDOW_LABEL,
        TYPING_INSIGHTS_WINDOW_LABEL, TYPING_INVADERS_WINDOW_LABEL,
        UNDERWATER_TYPING_FISHING_WINDOW_LABEL,
    };

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
    fn self_test_window_seed_uses_a_safe_layout_key() {
        assert_eq!(
            self_test_url("my-layout_2"),
            "self-test.html?layout=my-layout_2"
        );
        assert_eq!(
            self_test_url("bad?layout=other"),
            "self-test.html?layout=badlayoutother"
        );
    }

    #[test]
    fn secondary_window_registry_preserves_existing_desktop_window_metadata() {
        let expected = [
            (
                SETTINGS_WINDOW_LABEL,
                "settings.html",
                "Keyboard Helper Settings",
                (760.0, 720.0),
                (620.0, 560.0),
                "Settings",
            ),
            (
                TYPING_INVADERS_WINDOW_LABEL,
                "game.html",
                "Shift-Space Invaders",
                (1100.0, 720.0),
                (720.0, 560.0),
                "Shift-Space Invaders",
            ),
            (
                KEYBOARD_SNAKE_WINDOW_LABEL,
                "keyboard-snake.html",
                "Keyboard Snake",
                (900.0, 760.0),
                (560.0, 520.0),
                "Keyboard Snake",
            ),
            (
                "flappy-key-bird",
                "flappy-key-bird.html",
                "Flappy Key-Bird",
                (1000.0, 760.0),
                (620.0, 540.0),
                "Flappy Key-Bird",
            ),
            (
                UNDERWATER_TYPING_FISHING_WINDOW_LABEL,
                "underwater-typing-fishing.html",
                "Underwater Typing Fishing",
                (1100.0, 780.0),
                (640.0, 560.0),
                "Underwater Typing Fishing",
            ),
            (
                KEYBOARD_SELF_TEST_WINDOW_LABEL,
                "self-test.html?layout={layout}",
                "Keyboard Self-test",
                (680.0, 720.0),
                (500.0, 520.0),
                "Keyboard Self-test",
            ),
            (
                TYPING_INSIGHTS_WINDOW_LABEL,
                "typing-insights.html",
                "Typing Insights",
                (1120.0, 820.0),
                (680.0, 520.0),
                "Typing Insights",
            ),
        ];
        assert_eq!(SECONDARY_WINDOWS.len(), expected.len());
        for (label, url, title, inner_size, min_inner_size, creation_error_name) in expected {
            let descriptor = secondary_window_descriptor(label).expect("registered window");
            assert_eq!(descriptor.url, url);
            assert_eq!(descriptor.title, title);
            assert_eq!(descriptor.inner_size, inner_size);
            assert_eq!(descriptor.min_inner_size, min_inner_size);
            assert_eq!(descriptor.creation_error_name, creation_error_name);
            assert!(descriptor.resizable);
            assert!(descriptor.decorations);
            assert!(!descriptor.transparent);
            assert!(!descriptor.always_on_top);
        }
    }

    #[test]
    fn settings_window_creation_failure_has_actionable_context() {
        assert_eq!(
            secondary_window_creation_error(&KEYBOARD_SELF_TEST_WINDOW, "webview unavailable"),
            "failed to create Keyboard Self-test window: webview unavailable"
        );
    }
}
