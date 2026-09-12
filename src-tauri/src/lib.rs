#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_keyboard_helper_ble::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_keyboard_helper_layouts::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running Keyboard Helper Companion");
}
