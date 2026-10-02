use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const SNAPSHOT_FILE: &str = ".keyri-ai-coaching.json";
const RECOMMENDATIONS_FILE: &str = ".keyri-ai-coaching-recommendations.json";
const SNAPSHOT_SCHEMA_VERSION: u8 = 1;
const SNAPSHOT_TTL_MS: u64 = 30 * 60 * 1000;
const REPORT_URI: &str = "keyboard-helper://typing-report";

const OMITTED_DATA: [&str; 6] = [
    "raw normal-work text",
    "raw normal-work key logs",
    "firmware latency",
    "physical positions and layers",
    "combo identity",
    "keyboard device identity",
];

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("cannot read system clock: {error}"))
}

fn snapshot_path() -> Result<PathBuf, String> {
    Ok(crate::config_store::resolve_home()?.join(SNAPSHOT_FILE))
}

fn recommendations_path() -> Result<PathBuf, String> {
    Ok(crate::config_store::resolve_home()?.join(RECOMMENDATIONS_FILE))
}

fn contains_forbidden_key(value: &Value) -> bool {
    const FORBIDDEN: [&str; 16] = [
        "rawText",
        "rawTypedText",
        "rawKeyLogs",
        "keyLog",
        "orderedKeyHistory",
        "applicationNames",
        "firmwareLatency",
        "physicalPositions",
        "layers",
        "comboIdentity",
        "text",
        "applicationName",
        "keyHistory",
        "layer",
        "comboId",
        "deviceId",
    ];
    match value {
        Value::Array(values) => values.iter().any(contains_forbidden_key),
        Value::Object(object) => object
            .iter()
            .any(|(key, child)| FORBIDDEN.contains(&key.as_str()) || contains_forbidden_key(child)),
        _ => false,
    }
}

fn normalize_report(mut report: Value) -> Result<Value, String> {
    if !report.is_object() {
        return Err("AI Coaching report must be an object".into());
    }
    if contains_forbidden_key(&report) {
        return Err("AI Coaching report contains data that cannot be exported".into());
    }
    let object = report.as_object_mut().expect("report object checked above");
    let omitted = object
        .entry("omittedData")
        .or_insert_with(|| Value::Array(Vec::new()));
    let values = omitted
        .as_array_mut()
        .ok_or("omittedData must be an array")?;
    for item in OMITTED_DATA {
        if !values.iter().any(|value| value.as_str() == Some(item)) {
            values.push(Value::String(item.into()));
        }
    }
    object.insert(
        "consent".into(),
        json!({ "mode": "ai_coaching", "scope": "single-report-snapshot" }),
    );
    Ok(report)
}

fn read_snapshot() -> Result<Option<Value>, String> {
    let path = snapshot_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let snapshot: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let expires_at = snapshot
        .get("expiresAtUnixMs")
        .and_then(Value::as_u64)
        .ok_or("approved snapshot is missing expiration")?;
    if snapshot.get("revoked").and_then(Value::as_bool) == Some(true) || expires_at <= now_ms()? {
        let _ = std::fs::remove_file(path);
        return Ok(None);
    }
    Ok(snapshot.get("report").cloned())
}

#[tauri::command]
pub fn approve_ai_coaching_report(
    report: Value,
    ai_coaching_enabled: bool,
) -> Result<Value, String> {
    if !ai_coaching_enabled {
        return Err("AI Coaching mode is disabled".into());
    }
    let report = normalize_report(report)?;
    let approved_at = now_ms()?;
    let snapshot = json!({
        "schemaVersion": SNAPSHOT_SCHEMA_VERSION,
        "approvedAtUnixMs": approved_at,
        "expiresAtUnixMs": approved_at + SNAPSHOT_TTL_MS,
        "revoked": false,
        "report": report,
    });
    std::fs::write(
        snapshot_path()?,
        serde_json::to_vec_pretty(&snapshot).map_err(|e| e.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(json!({ "approvedAtUnixMs": approved_at, "expiresAtUnixMs": approved_at + SNAPSHOT_TTL_MS }))
}

#[tauri::command]
pub fn revoke_ai_coaching_report() -> Result<(), String> {
    let path = snapshot_path()?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    let recommendations = recommendations_path()?;
    if recommendations.exists() {
        std::fs::remove_file(recommendations).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_ai_coaching_status() -> Result<Value, String> {
    let path = snapshot_path()?;
    let active = read_snapshot()?.is_some();
    Ok(json!({ "active": active, "path": path.display().to_string() }))
}

#[tauri::command]
pub fn read_ai_coaching_recommendations() -> Result<Value, String> {
    if read_snapshot()?.is_none() {
        let path = recommendations_path()?;
        let _ = std::fs::remove_file(path);
        return Ok(json!([]));
    }
    let path = recommendations_path()?;
    if !path.exists() {
        return Ok(json!([]));
    }
    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn recommendation_supported(recommendation: &Value, report: &Value) -> bool {
    let serialized = recommendation.to_string().to_lowercase();
    if [
        "raw text",
        "raw key",
        "firmware",
        "physical position",
        "physical key",
        "layer",
        "combo",
        "chord",
        "device identity",
    ]
    .iter()
    .any(|term| serialized.contains(term))
    {
        return false;
    }
    let Some(evidence) = recommendation.get("evidence").and_then(Value::as_array) else {
        return false;
    };
    if evidence.is_empty() || evidence.iter().any(|value| !value.is_string()) {
        return false;
    }
    let report_text = report.to_string();
    let omitted = report
        .get("omittedData")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    evidence.iter().all(|value| {
        let item = value.as_str().unwrap_or_default();
        !omitted.iter().any(|omitted| omitted.as_str() == Some(item)) && report_text.contains(item)
    })
}

fn save_recommendations(recommendations: &Value, report: &Value) -> Result<Value, String> {
    let Some(values) = recommendations.as_array() else {
        return Err("recommendations must be an array".into());
    };
    let normalized: Vec<Value> = values
        .iter()
        .map(|recommendation| {
            let mut value = recommendation.clone();
            if !value.is_object() {
                return json!({ "supported": false, "reason": "Recommendation must be an object." });
            }
            let supported = recommendation_supported(recommendation, report);
            if let Some(object) = value.as_object_mut() {
                object.insert("supported".into(), Value::Bool(supported));
                if !supported {
                    object.insert("reason".into(), Value::String("Recommendation is not fully traceable to the approved aggregate report.".into()));
                }
            }
            value
        })
        .collect();
    let output = Value::Array(normalized);
    std::fs::write(
        recommendations_path()?,
        serde_json::to_vec_pretty(&output).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(output)
}

fn mcp_response(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn mcp_error(id: &Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn handle_mcp_request(request: &Value) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    match method {
        "initialize" => Some(mcp_response(
            &id,
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "resources": { "subscribe": false }, "tools": {} },
                "serverInfo": { "name": "keyboard-helper", "version": env!("CARGO_PKG_VERSION") }
            }),
        )),
        "notifications/initialized" | "ping" => None,
        "resources/list" => {
            let resources = if read_snapshot().ok().flatten().is_some() {
                vec![
                    json!({ "uri": REPORT_URI, "name": "Approved typing analytics report", "mimeType": "application/json" }),
                ]
            } else {
                Vec::new()
            };
            Some(mcp_response(&id, json!({ "resources": resources })))
        }
        "resources/read" => {
            let uri = request.pointer("/params/uri").and_then(Value::as_str);
            if uri != Some(REPORT_URI) {
                return Some(mcp_error(&id, -32602, "Unsupported resource URI"));
            }
            match read_snapshot() {
                Ok(Some(report)) => Some(mcp_response(
                    &id,
                    json!({ "contents": [{ "uri": REPORT_URI, "mimeType": "application/json", "text": report.to_string() }] }),
                )),
                Ok(None) => Some(mcp_error(
                    &id,
                    -32001,
                    "No approved AI Coaching report is available",
                )),
                Err(error) => Some(mcp_error(&id, -32000, &error)),
            }
        }
        "tools/list" => Some(mcp_response(
            &id,
            json!({ "tools": [
            { "name": "get_approved_typing_report", "description": "Read the user-approved aggregate typing report.", "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false } },
            { "name": "get_recommendation_context", "description": "Read aggregate evidence for advisory typing recommendations.", "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false } },
            { "name": "submit_recommendations", "description": "Submit advisory recommendations with evidence references.", "inputSchema": { "type": "object", "properties": { "recommendations": { "type": "array" } }, "required": ["recommendations"], "additionalProperties": false } }
        ] }),
        )),
        "tools/call" => {
            let name = request.pointer("/params/name").and_then(Value::as_str);
            if name == Some("submit_recommendations") {
                return match read_snapshot() {
                    Ok(Some(report)) => match save_recommendations(
                        request
                            .pointer("/params/arguments/recommendations")
                            .unwrap_or(&Value::Null),
                        &report,
                    ) {
                        Ok(saved) => Some(mcp_response(
                            &id,
                            json!({ "content": [{ "type": "text", "text": saved.to_string() }], "isError": false }),
                        )),
                        Err(error) => Some(mcp_error(&id, -32602, &error)),
                    },
                    Ok(None) => Some(mcp_error(
                        &id,
                        -32001,
                        "No approved AI Coaching report is available",
                    )),
                    Err(error) => Some(mcp_error(&id, -32000, &error)),
                };
            }
            if !matches!(
                name,
                Some("get_approved_typing_report") | Some("get_recommendation_context")
            ) {
                return Some(mcp_error(&id, -32602, "Unsupported tool"));
            }
            match read_snapshot() {
                Ok(Some(report)) => Some(mcp_response(
                    &id,
                    json!({ "content": [{ "type": "text", "text": report.to_string() }], "isError": false }),
                )),
                Ok(None) => Some(mcp_error(
                    &id,
                    -32001,
                    "No approved AI Coaching report is available",
                )),
                Err(error) => Some(mcp_error(&id, -32000, &error)),
            }
        }
        _ => Some(mcp_error(&id, -32601, "Method not found")),
    }
}

pub fn run_mcp_stdio() -> Result<(), String> {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout());
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Value =
            serde_json::from_str(&line).map_err(|error| format!("invalid MCP JSON: {error}"))?;
        if let Some(response) = handle_mcp_request(&request) {
            serde_json::to_writer(&mut stdout, &response).map_err(|error| error.to_string())?;
            stdout.write_all(b"\n").map_err(|error| error.to_string())?;
            stdout.flush().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
