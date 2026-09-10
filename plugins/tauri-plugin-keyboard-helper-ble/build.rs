const COMMANDS: &[&str] = &[
    "permission_status",
    "request_permissions",
    "bluetooth_availability",
    "observe_bluetooth_availability",
    "stop_observing_bluetooth_availability",
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
