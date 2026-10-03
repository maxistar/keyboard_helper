use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size, State, WebviewWindow};

#[derive(Clone, Debug, PartialEq, Eq)]
struct OverlayWindowSnapshot {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    decorations: bool,
}

#[derive(Default)]
pub(crate) struct OverlayGeometryState {
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

#[derive(Debug, PartialEq, Eq)]
enum OverlayVisibilityAction {
    Hide,
    ShowAndFocus,
}

fn overlay_visibility_action(is_visible: bool) -> OverlayVisibilityAction {
    if is_visible {
        OverlayVisibilityAction::Hide
    } else {
        OverlayVisibilityAction::ShowAndFocus
    }
}

#[tauri::command]
pub(crate) fn toggle_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    toggle_keyboard_overlay(&app_handle)
}

pub(crate) fn toggle_keyboard_overlay(app_handle: &tauri::AppHandle) -> Result<(), String> {
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
pub(crate) fn set_window_decorations(
    app_handle: tauri::AppHandle,
    decorations: bool,
) -> Result<(), String> {
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
pub(crate) struct MiniGeometryRequest {
    content_width: f64,
    content_height: f64,
    target_scale: f64,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MiniGeometryResult {
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
pub(crate) fn enter_mini_geometry(
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
pub(crate) fn update_mini_geometry(
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
pub(crate) fn restore_full_geometry(
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

#[cfg(test)]
mod tests {
    use super::{
        centered_rect, clamp_rect_to_work_area, fit_mini_scale, overlay_visibility_action,
        GeometryRect, OverlayGeometryState, OverlayVisibilityAction, OverlayWindowSnapshot,
    };
    use tauri::{PhysicalPosition, PhysicalSize};

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
}
