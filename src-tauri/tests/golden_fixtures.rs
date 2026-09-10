use serde_json::Value;

fn fixture(source: &str) -> Value {
    serde_json::from_str(source).expect("golden fixture must contain valid JSON")
}

#[test]
fn layout_fixtures_keep_required_contract_fields() {
    for source in [
        include_str!("../../tests/fixtures/layouts/qwerty-minimal.json"),
        include_str!("../../tests/fixtures/layouts/corne-connected.json"),
        include_str!("../../tests/fixtures/layouts/external-minimal.json"),
    ] {
        let value = fixture(source);
        assert!(value["name"].is_string());
        assert!(value["keyPositions"].is_array());
        assert!(value["keyLayers"].is_object() || value["keyLayers"].is_array());
    }
}

#[test]
fn ble_session_fixtures_cover_read_only_and_writable_states() {
    let read_only = fixture(include_str!(
        "../../tests/fixtures/ble/read-only-session.json"
    ));
    let writable = fixture(include_str!(
        "../../tests/fixtures/ble/writable-session.json"
    ));
    assert_eq!(read_only["writable"], false);
    assert_eq!(writable["writable"], true);
}
