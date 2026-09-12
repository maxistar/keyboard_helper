use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod mobile;
mod models;

pub use error::{Error, Result};
use mobile::KeyboardHelperLayouts;
pub use models::*;

pub(crate) trait KeyboardHelperLayoutsExt<R: Runtime> {
    fn keyboard_helper_layouts(&self) -> &KeyboardHelperLayouts<R>;
}

impl<R: Runtime, T: Manager<R>> KeyboardHelperLayoutsExt<R> for T {
    fn keyboard_helper_layouts(&self) -> &KeyboardHelperLayouts<R> {
        self.state::<KeyboardHelperLayouts<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keyboard-helper-layouts")
        .invoke_handler(tauri::generate_handler![
            commands::pick_layout,
            commands::list_records,
            commands::write_record,
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
