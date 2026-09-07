use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod mobile;
mod models;

pub use error::{Error, Result};
use mobile::KeyboardHelperBle;
pub use models::*;

pub(crate) trait KeyboardHelperBleExt<R: Runtime> {
    fn keyboard_helper_ble(&self) -> &KeyboardHelperBle<R>;
}

impl<R: Runtime, T: Manager<R>> KeyboardHelperBleExt<R> for T {
    fn keyboard_helper_ble(&self) -> &KeyboardHelperBle<R> {
        self.state::<KeyboardHelperBle<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keyboard-helper-ble")
        .invoke_handler(tauri::generate_handler![
            commands::permission_status,
            commands::request_permissions,
            commands::start_scan,
            commands::stop_scan,
            commands::connect,
            commands::list_services,
            commands::read,
            commands::subscribe,
            commands::unsubscribe,
            commands::disconnect,
        ])
        .setup(|app, api| {
            let transport = mobile::init(app, api)?;
            app.manage(transport);
            Ok(())
        })
        .build()
}
