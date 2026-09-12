const COMMANDS: &[&str] = &[
    "pick_layout",
    "list_records",
    "write_record",
    "commit_package",
    "discard_package",
    "read_asset",
    "remove_record",
    "read_selection",
    "write_selection",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
