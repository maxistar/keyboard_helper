use crate::mini_geometry::toggle_keyboard_overlay;
use crate::native_constants::*;
use crate::secondary_windows::{
    open_flappy_key_bird_window, open_keyboard_snake_window, open_settings_window,
    open_typing_insights_window, open_typing_invaders_window,
    open_underwater_typing_fishing_window,
};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppMenuAction {
    OpenSettings,
    ToggleOverlay,
    EnterMiniMode,
    OpenTypingInvaders,
    OpenKeyboardSnake,
    OpenFlappyKeyBird,
    OpenUnderwaterTypingFishing,
    OpenTypingInsights,
    OpenHelp,
}

impl AppMenuAction {
    fn from_menu_id(menu_id: &str) -> Option<Self> {
        match menu_id {
            SETTINGS_MENU_ID => Some(Self::OpenSettings),
            TOGGLE_OVERLAY_MENU_ID => Some(Self::ToggleOverlay),
            ENTER_MINI_MODE_MENU_ID => Some(Self::EnterMiniMode),
            TYPING_INVADERS_MENU_ID => Some(Self::OpenTypingInvaders),
            KEYBOARD_SNAKE_MENU_ID => Some(Self::OpenKeyboardSnake),
            FLAPPY_KEY_BIRD_MENU_ID => Some(Self::OpenFlappyKeyBird),
            UNDERWATER_TYPING_FISHING_MENU_ID => Some(Self::OpenUnderwaterTypingFishing),
            TYPING_INSIGHTS_MENU_ID => Some(Self::OpenTypingInsights),
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
            Self::OpenKeyboardSnake => "Keyboard Snake",
            Self::OpenFlappyKeyBird => "Flappy Key-Bird",
            Self::OpenUnderwaterTypingFishing => "Underwater Typing Fishing",
            Self::OpenTypingInsights => "Typing Insights",
            Self::OpenHelp => "Keyboard Helper Help",
        }
    }
}

pub(crate) trait AppMenuActionHandler {
    fn open_settings(&mut self) -> Result<(), String>;
    fn toggle_overlay(&mut self) -> Result<(), String>;
    fn enter_mini_mode(&mut self) -> Result<(), String>;
    fn open_typing_invaders(&mut self) -> Result<(), String>;
    fn open_keyboard_snake(&mut self) -> Result<(), String>;
    fn open_flappy_key_bird(&mut self) -> Result<(), String>;
    fn open_underwater_typing_fishing(&mut self) -> Result<(), String>;
    fn open_typing_insights(&mut self) -> Result<(), String>;
    fn open_help(&mut self) -> Result<(), String>;
}

pub(crate) fn dispatch_app_menu_action(
    menu_id: &str,
    handler: &mut impl AppMenuActionHandler,
) -> bool {
    let Some(action) = AppMenuAction::from_menu_id(menu_id) else {
        return false;
    };

    let result = match action {
        AppMenuAction::OpenSettings => handler.open_settings(),
        AppMenuAction::ToggleOverlay => handler.toggle_overlay(),
        AppMenuAction::EnterMiniMode => handler.enter_mini_mode(),
        AppMenuAction::OpenTypingInvaders => handler.open_typing_invaders(),
        AppMenuAction::OpenKeyboardSnake => handler.open_keyboard_snake(),
        AppMenuAction::OpenFlappyKeyBird => handler.open_flappy_key_bird(),
        AppMenuAction::OpenUnderwaterTypingFishing => handler.open_underwater_typing_fishing(),
        AppMenuAction::OpenTypingInsights => handler.open_typing_insights(),
        AppMenuAction::OpenHelp => handler.open_help(),
    };

    if let Err(error) = result {
        eprintln!("Failed to handle {} menu action: {error}", action.label());
    }

    true
}

pub(crate) struct NativeAppMenuActionHandler<'a> {
    pub(crate) app_handle: &'a tauri::AppHandle,
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

    fn open_keyboard_snake(&mut self) -> Result<(), String> {
        open_keyboard_snake_window(self.app_handle)
    }

    fn open_flappy_key_bird(&mut self) -> Result<(), String> {
        open_flappy_key_bird_window(self.app_handle)
    }

    fn open_underwater_typing_fishing(&mut self) -> Result<(), String> {
        open_underwater_typing_fishing_window(self.app_handle)
    }

    fn open_typing_insights(&mut self) -> Result<(), String> {
        open_typing_insights_window(self.app_handle)
    }

    fn open_help(&mut self) -> Result<(), String> {
        self.app_handle
            .opener()
            .open_url(HELP_URL, None::<&str>)
            .map_err(|error| format!("failed to open {HELP_URL}: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{dispatch_app_menu_action, AppMenuAction, AppMenuActionHandler};
    use crate::native_constants::{
        ENTER_MINI_MODE_MENU_ID, FLAPPY_KEY_BIRD_MENU_ID, HELP_MENU_ID, KEYBOARD_SNAKE_MENU_ID,
        SETTINGS_MENU_ID, TOGGLE_OVERLAY_MENU_ID, TYPING_INSIGHTS_MENU_ID, TYPING_INVADERS_MENU_ID,
        UNDERWATER_TYPING_FISHING_MENU_ID,
    };

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
        fn open_keyboard_snake(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenKeyboardSnake)
        }
        fn open_flappy_key_bird(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenFlappyKeyBird)
        }
        fn open_underwater_typing_fishing(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenUnderwaterTypingFishing)
        }
        fn open_typing_insights(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenTypingInsights)
        }
        fn open_help(&mut self) -> Result<(), String> {
            self.record(AppMenuAction::OpenHelp)
        }
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
        assert!(dispatch_app_menu_action(
            KEYBOARD_SNAKE_MENU_ID,
            &mut handler
        ));
        assert!(dispatch_app_menu_action(
            FLAPPY_KEY_BIRD_MENU_ID,
            &mut handler
        ));
        assert!(dispatch_app_menu_action(
            UNDERWATER_TYPING_FISHING_MENU_ID,
            &mut handler
        ));
        assert!(dispatch_app_menu_action(
            TYPING_INSIGHTS_MENU_ID,
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
                AppMenuAction::OpenKeyboardSnake,
                AppMenuAction::OpenFlappyKeyBird,
                AppMenuAction::OpenUnderwaterTypingFishing,
                AppMenuAction::OpenTypingInsights,
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
