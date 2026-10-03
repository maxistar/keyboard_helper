use crate::app_menu::{dispatch_app_menu_action, NativeAppMenuActionHandler};
use crate::native_constants::*;
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, PredefinedMenuItem, Submenu};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub(crate) fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
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
pub(crate) fn install_macos_application_menu(app: &mut tauri::App) -> tauri::Result<()> {
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
    let keyboard_snake = MenuItem::with_id(
        app,
        KEYBOARD_SNAKE_MENU_ID,
        "Keyboard Snake",
        true,
        None::<&str>,
    )?;
    let flappy_key_bird = MenuItem::with_id(
        app,
        FLAPPY_KEY_BIRD_MENU_ID,
        "Flappy Key-Bird",
        true,
        None::<&str>,
    )?;
    let underwater_typing_fishing = MenuItem::with_id(
        app,
        UNDERWATER_TYPING_FISHING_MENU_ID,
        "Underwater Typing Fishing",
        true,
        None::<&str>,
    )?;
    let typing_insights = MenuItem::with_id(
        app,
        TYPING_INSIGHTS_MENU_ID,
        "Typing Insights",
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
        &[
            &toggle_overlay,
            &enter_mini_mode,
            &typing_invaders,
            &keyboard_snake,
            &flappy_key_bird,
            &underwater_typing_fishing,
            &PredefinedMenuItem::separator(app)?,
            &typing_insights,
        ],
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
