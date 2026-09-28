use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const HISTOGRAM_BUCKETS: usize = 13;

pub struct TypingAnalyticsState {
    connection: Mutex<Option<Connection>>,
    deletion_cutoff_ms: AtomicU64,
}

impl Default for TypingAnalyticsState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
            deletion_cutoff_ms: AtomicU64::new(0),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsContext {
    pub layout: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsRecord {
    pub schema_version: u8,
    pub day: String,
    pub collected_at_unix_ms: u64,
    #[serde(rename = "type")]
    pub record_type: String,
    pub context: Option<AnalyticsContext>,
    pub code: Option<String>,
    pub from_code: Option<String>,
    pub to_code: Option<String>,
    pub latency_bucket: Option<usize>,
    pub latency_ms: Option<u32>,
    pub exercise: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsStorageInfo {
    pub schema_version: u8,
    pub path: String,
    pub retention_days: u16,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("typing-analytics.sqlite"))
}

fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS analytics_aggregates (
           schema_version INTEGER NOT NULL,
           day TEXT NOT NULL,
           collection_type TEXT NOT NULL,
           layout TEXT NOT NULL,
           language TEXT NOT NULL,
           metric_type TEXT NOT NULL,
           from_code TEXT NOT NULL DEFAULT '',
           to_code TEXT NOT NULL DEFAULT '',
           sample_count INTEGER NOT NULL DEFAULT 0,
           correction_count INTEGER NOT NULL DEFAULT 0,
           latency_sum_ms INTEGER NOT NULL DEFAULT 0,
           histogram_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0,0]',
           payload_json TEXT,
           PRIMARY KEY(day, collection_type, layout, language, metric_type, from_code, to_code)
         );
         CREATE INDEX IF NOT EXISTS analytics_aggregates_context
           ON analytics_aggregates(collection_type, layout, language, day);
         DELETE FROM analytics_aggregates WHERE day < date('now', 'localtime', '-89 days');",
        )
        .map_err(|error| error.to_string())
}

fn with_connection<T>(
    app: &AppHandle,
    state: &TypingAnalyticsState,
    operation: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.connection.lock().map_err(|error| error.to_string())?;
    if guard.is_none() {
        let connection =
            Connection::open(database_path(app)?).map_err(|error| error.to_string())?;
        initialize(&connection)?;
        *guard = Some(connection);
    }
    operation(guard.as_mut().expect("analytics connection initialized"))
}

pub fn initialize_app(app: &AppHandle, state: &TypingAnalyticsState) -> Result<(), String> {
    with_connection(app, state, |_| Ok(()))
}

fn context(record: &AnalyticsRecord) -> (String, String) {
    let layout = record
        .context
        .as_ref()
        .and_then(|value| value.layout.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown".into());
    let language = record
        .context
        .as_ref()
        .and_then(|value| value.language.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown".into());
    (layout, language)
}

#[tauri::command]
pub fn record_typing_analytics(
    app: AppHandle,
    state: tauri::State<'_, TypingAnalyticsState>,
    record: AnalyticsRecord,
) -> Result<(), String> {
    let cutoff = state.deletion_cutoff_ms.load(Ordering::SeqCst);
    with_connection(&app, &state, |connection| {
        apply_record(connection, &record, cutoff).map(|_| ())
    })
}

/// Applies one aggregate record; returns `false` when the record predates the latest deletion.
fn apply_record(
    connection: &Connection,
    record: &AnalyticsRecord,
    deletion_cutoff_ms: u64,
) -> Result<bool, String> {
    if record.schema_version != 1 || record.day.len() != 10 {
        return Err("unsupported analytics record".into());
    }
    if record.collected_at_unix_ms <= deletion_cutoff_ms {
        return Ok(false);
    }
    let (layout, language) = context(record);
    let from_code = record
        .from_code
        .as_deref()
        .or(record.code.as_deref())
        .unwrap_or("");
    let to_code = record.to_code.as_deref().unwrap_or("");
    match record.record_type.as_str() {
        "key" => {
            connection.execute(
                    "INSERT INTO analytics_aggregates(schema_version,day,collection_type,layout,language,metric_type,from_code,sample_count)
                     VALUES(1,?1,'background',?2,?3,'key',?4,1)
                     ON CONFLICT DO UPDATE SET sample_count=sample_count+1",
                    params![record.day, layout, language, from_code],
                ).map_err(|error| error.to_string())?;
        }
        "pair" => {
            let bucket = record
                .latency_bucket
                .filter(|value| *value < HISTOGRAM_BUCKETS)
                .ok_or("invalid latency bucket")?;
            let latency = record
                .latency_ms
                .filter(|value| *value <= 2_000)
                .ok_or("invalid latency")?;
            let existing: Option<String> = connection.query_row(
                    "SELECT histogram_json FROM analytics_aggregates WHERE day=?1 AND collection_type='background' AND layout=?2 AND language=?3 AND metric_type='pair' AND from_code=?4 AND to_code=?5",
                    params![record.day, layout, language, from_code, to_code], |row| row.get(0),
                ).optional().map_err(|error| error.to_string())?;
            let mut histogram: Vec<u64> = existing
                .and_then(|value| serde_json::from_str(&value).ok())
                .unwrap_or_else(|| vec![0; HISTOGRAM_BUCKETS]);
            histogram.resize(HISTOGRAM_BUCKETS, 0);
            histogram[bucket] += 1;
            let serialized =
                serde_json::to_string(&histogram).map_err(|error| error.to_string())?;
            connection.execute(
                    "INSERT INTO analytics_aggregates(schema_version,day,collection_type,layout,language,metric_type,from_code,to_code,sample_count,latency_sum_ms,histogram_json)
                     VALUES(1,?1,'background',?2,?3,'pair',?4,?5,1,?6,?7)
                     ON CONFLICT DO UPDATE SET sample_count=sample_count+1, latency_sum_ms=latency_sum_ms+excluded.latency_sum_ms, histogram_json=excluded.histogram_json",
                    params![record.day, layout, language, from_code, to_code, latency, serialized],
                ).map_err(|error| error.to_string())?;
        }
        "correction" => {
            connection.execute(
                    "INSERT INTO analytics_aggregates(schema_version,day,collection_type,layout,language,metric_type,from_code,to_code,correction_count)
                     VALUES(1,?1,'background',?2,?3,'pair',?4,?5,1)
                     ON CONFLICT DO UPDATE SET correction_count=correction_count+1",
                    params![record.day, layout, language, from_code, to_code],
                ).map_err(|error| error.to_string())?;
        }
        "exercise" => {
            let payload = record
                .exercise
                .as_ref()
                .ok_or("missing exercise aggregate")?;
            let number = |key: &str| payload.get(key).and_then(Value::as_f64).unwrap_or(0.0);
            let aggregate = json!({
                "game": payload.get("game").and_then(Value::as_str).unwrap_or("unknown"),
                "sessionCount": 1, "totalScore": number("score"), "highestWave": number("highestWave"),
                "completedTargets": number("completedTargets"), "correctCharacters": number("correctCharacters"),
                "mistakes": number("mistakes"), "activeDurationMs": number("activeDurationMs")
            });
            let serialized =
                serde_json::to_string(&aggregate).map_err(|error| error.to_string())?;
            connection.execute(
                    "INSERT INTO analytics_aggregates(schema_version,day,collection_type,layout,language,metric_type,sample_count,payload_json)
                     VALUES(1,?1,'exercise',?2,?3,'session',1,?4)
                     ON CONFLICT DO UPDATE SET sample_count=sample_count+1, payload_json=json_object(
                       'game', json_extract(excluded.payload_json,'$.game'),
                       'sessionCount', COALESCE(json_extract(payload_json,'$.sessionCount'),0)+1,
                       'totalScore', COALESCE(json_extract(payload_json,'$.totalScore'),0)+COALESCE(json_extract(excluded.payload_json,'$.totalScore'),0),
                       'highestWave', MAX(COALESCE(json_extract(payload_json,'$.highestWave'),0),COALESCE(json_extract(excluded.payload_json,'$.highestWave'),0)),
                       'completedTargets', COALESCE(json_extract(payload_json,'$.completedTargets'),0)+COALESCE(json_extract(excluded.payload_json,'$.completedTargets'),0),
                       'correctCharacters', COALESCE(json_extract(payload_json,'$.correctCharacters'),0)+COALESCE(json_extract(excluded.payload_json,'$.correctCharacters'),0),
                       'mistakes', COALESCE(json_extract(payload_json,'$.mistakes'),0)+COALESCE(json_extract(excluded.payload_json,'$.mistakes'),0),
                       'activeDurationMs', COALESCE(json_extract(payload_json,'$.activeDurationMs'),0)+COALESCE(json_extract(excluded.payload_json,'$.activeDurationMs'),0)
                     )",
                    params![record.day, layout, language, serialized],
                ).map_err(|error| error.to_string())?;
        }
        "exerciseTarget" => {
            let target = record.code.as_deref().ok_or("missing exercise target")?;
            let mistakes = record
                .exercise
                .as_ref()
                .and_then(|value| value.get("mistakes"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let completed = record
                .exercise
                .as_ref()
                .and_then(|value| value.get("completed"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let duration = record.latency_ms.unwrap_or(0);
            connection.execute(
                    "INSERT INTO analytics_aggregates(schema_version,day,collection_type,layout,language,metric_type,from_code,sample_count,correction_count,latency_sum_ms,payload_json)
                     VALUES(1,?1,'exercise',?2,?3,'target',?4,1,?5,?6,json_object('completedCount',?7))
                     ON CONFLICT DO UPDATE SET sample_count=sample_count+1, correction_count=correction_count+excluded.correction_count,
                       latency_sum_ms=latency_sum_ms+excluded.latency_sum_ms,
                       payload_json=json_object('completedCount',COALESCE(json_extract(payload_json,'$.completedCount'),0)+?7)",
                    params![record.day, layout, language, target, mistakes, duration, u8::from(completed)],
                ).map_err(|error| error.to_string())?;
        }
        _ => return Err("unsupported analytics record type".into()),
    }
    connection
        .execute(
            "DELETE FROM analytics_aggregates WHERE day < date('now', 'localtime', '-89 days')",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn read_typing_analytics(
    app: AppHandle,
    state: tauri::State<'_, TypingAnalyticsState>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<Value>, String> {
    with_connection(&app, &state, |connection| read_rows(connection, from, to))
}

fn read_rows(
    connection: &Connection,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare(
            "SELECT day,collection_type,layout,language,metric_type,from_code,to_code,sample_count,correction_count,latency_sum_ms,histogram_json,payload_json
             FROM analytics_aggregates WHERE (?1 IS NULL OR day>=?1) AND (?2 IS NULL OR day<=?2) ORDER BY day,collection_type,metric_type,from_code,to_code"
        ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![from, to], |row| {
            let histogram: String = row.get(10)?;
            let payload: Option<String> = row.get(11)?;
            Ok(json!({
                "day": row.get::<_, String>(0)?, "collectionType": row.get::<_, String>(1)?,
                "layout": row.get::<_, String>(2)?, "language": row.get::<_, String>(3)?,
                "type": row.get::<_, String>(4)?, "fromCode": row.get::<_, String>(5)?, "toCode": row.get::<_, String>(6)?,
                "sampleCount": row.get::<_, u64>(7)?, "correctionCount": row.get::<_, u64>(8)?, "latencySumMs": row.get::<_, u64>(9)?,
                "histogram": serde_json::from_str::<Value>(&histogram).unwrap_or_else(|_| json!([])),
                "exercise": payload.and_then(|value| serde_json::from_str::<Value>(&value).ok())
            }))
        }).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_typing_analytics(
    app: AppHandle,
    state: tauri::State<'_, TypingAnalyticsState>,
) -> Result<(), String> {
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64;
    state.deletion_cutoff_ms.store(cutoff, Ordering::SeqCst);
    with_connection(&app, &state, |connection| {
        connection
            .execute("DELETE FROM analytics_aggregates", [])
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn typing_analytics_storage_info(app: AppHandle) -> Result<AnalyticsStorageInfo, String> {
    Ok(AnalyticsStorageInfo {
        schema_version: 1,
        path: database_path(&app)?.display().to_string(),
        retention_days: 90,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_round_trip_and_retention_keep_only_supported_aggregate_rows() {
        let connection = Connection::open_in_memory().unwrap();
        initialize(&connection).unwrap();
        connection.execute(
            "INSERT INTO analytics_aggregates(schema_version,day,collection_type,layout,language,metric_type,from_code,sample_count)
             VALUES(1,date('now','localtime'),'background','qwerty','en','key','KeyA',3)", [],
        ).unwrap();
        let row: (u64, String) = connection
            .query_row(
                "SELECT sample_count,from_code FROM analytics_aggregates",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (3, "KeyA".into()));
        connection.execute(
            "INSERT INTO analytics_aggregates(schema_version,day,collection_type,layout,language,metric_type,from_code)
             VALUES(1,'2000-01-01','background','unknown','unknown','key','KeyB')", [],
        ).unwrap();
        initialize(&connection).unwrap();
        let expired: u64 = connection
            .query_row(
                "SELECT COUNT(*) FROM analytics_aggregates WHERE day='2000-01-01'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(expired, 0);
    }

    #[test]
    fn deletion_cutoff_rejects_pre_delete_records() {
        let connection = memory_connection();
        let today = today(&connection);
        assert!(!apply_record(
            &connection,
            &pair_record(&today, 150, "KeyA", "KeyS", 2, 110),
            200
        )
        .unwrap());
        assert!(!apply_record(
            &connection,
            &pair_record(&today, 200, "KeyA", "KeyS", 2, 110),
            200
        )
        .unwrap());
        assert!(read_rows(&connection, None, None).unwrap().is_empty());
        assert!(apply_record(
            &connection,
            &pair_record(&today, 201, "KeyA", "KeyS", 2, 110),
            200
        )
        .unwrap());
        assert_eq!(read_rows(&connection, None, None).unwrap().len(), 1);
    }

    #[test]
    fn write_in_flight_during_deletion_cannot_restore_history() {
        let connection = memory_connection();
        let today = today(&connection);
        apply_record(
            &connection,
            &pair_record(&today, 100, "KeyA", "KeyS", 2, 110),
            0,
        )
        .unwrap();
        connection
            .execute("DELETE FROM analytics_aggregates", [])
            .unwrap();
        let cutoff = 150;
        // Collected before the deletion but delivered after it.
        assert!(!apply_record(
            &connection,
            &pair_record(&today, 140, "KeyA", "KeyS", 2, 110),
            cutoff
        )
        .unwrap());
        assert!(read_rows(&connection, None, None).unwrap().is_empty());
    }

    #[test]
    fn records_round_trip_through_daily_aggregates() {
        let connection = memory_connection();
        let today = today(&connection);
        apply_record(
            &connection,
            &pair_record(&today, 10, "KeyA", "KeyS", 2, 110),
            0,
        )
        .unwrap();
        apply_record(
            &connection,
            &pair_record(&today, 11, "KeyA", "KeyS", 5, 400),
            0,
        )
        .unwrap();
        apply_record(
            &connection,
            &record(&today, 12, "correction", Some("KeyA"), Some("KeyS"), None),
            0,
        )
        .unwrap();
        apply_record(&connection, &record(&today, 13, "key", None, None, None), 0).unwrap();
        apply_record(
            &connection,
            &record(
                &today,
                14,
                "exercise",
                None,
                None,
                Some(json!({
                    "game": "typing-invaders", "score": 10, "highestWave": 2, "completedTargets": 3,
                    "correctCharacters": 50, "mistakes": 5, "activeDurationMs": 60_000
                })),
            ),
            0,
        )
        .unwrap();
        apply_record(
            &connection,
            &record(
                &today,
                15,
                "exercise",
                None,
                None,
                Some(json!({
                    "game": "typing-invaders", "score": 5, "highestWave": 4, "completedTargets": 1,
                    "correctCharacters": 25, "mistakes": 0, "activeDurationMs": 30_000
                })),
            ),
            0,
        )
        .unwrap();

        let rows = read_rows(&connection, Some(today.clone()), Some(today.clone())).unwrap();
        let pair = rows.iter().find(|row| row["type"] == "pair").unwrap();
        assert_eq!(pair["sampleCount"], 2);
        assert_eq!(pair["correctionCount"], 1);
        assert_eq!(pair["latencySumMs"], 510);
        assert_eq!(pair["histogram"][2], 1);
        assert_eq!(pair["histogram"][5], 1);
        let session = rows.iter().find(|row| row["type"] == "session").unwrap();
        assert_eq!(session["collectionType"], "exercise");
        assert_eq!(session["exercise"]["sessionCount"], 2);
        assert_eq!(
            session["exercise"]["correctCharacters"].as_f64(),
            Some(75.0)
        );
        assert_eq!(session["exercise"]["mistakes"].as_f64(), Some(5.0));
        assert_eq!(
            session["exercise"]["activeDurationMs"].as_f64(),
            Some(90_000.0)
        );
        assert_eq!(session["exercise"]["highestWave"].as_f64(), Some(4.0));
        let key = rows.iter().find(|row| row["type"] == "key").unwrap();
        assert_eq!(key["layout"], "qwerty");
        assert_eq!(key["fromCode"], "KeyD");
        assert!(rows
            .iter()
            .all(|row| row.get("text").is_none() && row.get("character").is_none()));
    }

    fn memory_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        initialize(&connection).unwrap();
        connection
    }

    fn today(connection: &Connection) -> String {
        connection
            .query_row("SELECT date('now','localtime')", [], |row| row.get(0))
            .unwrap()
    }

    fn record(
        day: &str,
        collected_at: u64,
        record_type: &str,
        from: Option<&str>,
        to: Option<&str>,
        exercise: Option<Value>,
    ) -> AnalyticsRecord {
        AnalyticsRecord {
            schema_version: 1,
            day: day.into(),
            collected_at_unix_ms: collected_at,
            record_type: record_type.into(),
            context: Some(AnalyticsContext {
                layout: Some("qwerty".into()),
                language: Some("en".into()),
            }),
            code: if record_type == "key" {
                Some("KeyD".into())
            } else {
                None
            },
            from_code: from.map(Into::into),
            to_code: to.map(Into::into),
            latency_bucket: None,
            latency_ms: None,
            exercise,
        }
    }

    fn pair_record(
        day: &str,
        collected_at: u64,
        from: &str,
        to: &str,
        bucket: usize,
        latency: u32,
    ) -> AnalyticsRecord {
        AnalyticsRecord {
            latency_bucket: Some(bucket),
            latency_ms: Some(latency),
            ..record(day, collected_at, "pair", Some(from), Some(to), None)
        }
    }
}
