#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(any(target_os = "android", target_os = "ios"))]
mod commands;
#[cfg(any(target_os = "android", target_os = "ios"))]
mod error;
#[cfg(any(target_os = "android", target_os = "ios"))]
mod mobile;
mod models;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub use error::{Error, Result};
#[cfg(any(target_os = "android", target_os = "ios"))]
use mobile::KeyboardHelperLayouts;
pub use models::*;

#[cfg(any(target_os = "android", target_os = "ios"))]
pub(crate) trait KeyboardHelperLayoutsExt<R: Runtime> {
    fn keyboard_helper_layouts(&self) -> &KeyboardHelperLayouts<R>;
}

#[cfg(any(target_os = "android", target_os = "ios"))]
impl<R: Runtime, T: Manager<R>> KeyboardHelperLayoutsExt<R> for T {
    fn keyboard_helper_layouts(&self) -> &KeyboardHelperLayouts<R> {
        self.state::<KeyboardHelperLayouts<R>>().inner()
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keyboard-helper-layouts")
        .invoke_handler(tauri::generate_handler![
            commands::pick_layout,
            commands::list_records,
            commands::write_record,
            commands::commit_package,
            commands::discard_package,
            commands::read_asset,
            commands::remove_record,
            commands::read_selection,
            commands::write_selection,
        ])
        .setup(|app, api| {
            let layouts = mobile::init(app, api)?;
            app.manage(layouts);
            Ok(())
        })
        .build()
}
