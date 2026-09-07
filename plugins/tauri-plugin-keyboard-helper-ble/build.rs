const COMMANDS: &[&str] = &[
    "permission_status",
    "request_permissions",
    "start_scan",
    "stop_scan",
    "connect",
    "list_services",
    "read",
    "subscribe",
    "unsubscribe",
    "disconnect",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
