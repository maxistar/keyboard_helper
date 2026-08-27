use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PRIMARY_FILE: &str = ".keyri.json";
const LEGACY_FILE: &str = "keyri.json";

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadResult {
    pub status: String,
    pub path: String,
    pub source_path: Option<String>,
    pub revision: String,
    pub data: Option<Value>,
    pub error: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigRequest {
    pub config: Value,
    pub source_path: Option<String>,
    pub revision: String,
    #[serde(default)]
    pub replace_invalid: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSaveResult {
    pub path: String,
    pub revision: String,
    pub backup_path: Option<String>,
}

pub fn resolve_home() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|error| format!("cannot resolve home directory: {error}"))
}

fn paths(home: &Path) -> (PathBuf, PathBuf) {
    (home.join(PRIMARY_FILE), home.join(LEGACY_FILE))
}

fn revision_for(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("failed to read {}: {error}", path.display()))
}

pub fn read_config_at(home: &Path) -> Result<ConfigReadResult, String> {
    let (primary, legacy) = paths(home);
    let source = if primary.exists() {
        Some(primary.clone())
    } else if legacy.exists() {
        Some(legacy)
    } else {
        None
    };
    let Some(source) = source else {
        return Ok(ConfigReadResult {
            status: "missing".into(),
            path: primary.display().to_string(),
            source_path: None,
            revision: "missing".into(),
            data: None,
            error: None,
        });
    };

    let bytes = read_bytes(&source)?;
    let revision = revision_for(&bytes);
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) if value.is_object() => Ok(ConfigReadResult {
            status: "valid".into(),
            path: primary.display().to_string(),
            source_path: Some(source.display().to_string()),
            revision,
            data: Some(value),
            error: None,
        }),
        Ok(_) => Ok(ConfigReadResult {
            status: "invalid".into(),
            path: primary.display().to_string(),
            source_path: Some(source.display().to_string()),
            revision,
            data: None,
            error: Some("configuration must be a top-level JSON object".into()),
        }),
        Err(error) => Ok(ConfigReadResult {
            status: "invalid".into(),
            path: primary.display().to_string(),
            source_path: Some(source.display().to_string()),
            revision,
            data: None,
            error: Some(format!("invalid JSON: {error}")),
        }),
    }
}

fn ensure_current_revision(
    home: &Path,
    source_path: Option<&str>,
    expected: &str,
) -> Result<Option<PathBuf>, String> {
    let (primary, legacy) = paths(home);
    match source_path {
        None => {
            if expected != "missing" || primary.exists() || legacy.exists() {
                return Err(
                    "configuration changed since Settings was opened; reload and try again".into(),
                );
            }
            Ok(None)
        }
        Some(source) => {
            let source = PathBuf::from(source);
            if source != primary && source != legacy {
                return Err("configuration source is outside the supported settings paths".into());
            }
            let bytes = read_bytes(&source)?;
            if revision_for(&bytes) != expected {
                return Err(
                    "configuration changed since Settings was opened; reload and try again".into(),
                );
            }
            Ok(Some(source))
        }
    }
}

fn backup_invalid(source: &Path) -> Result<PathBuf, String> {
    let bytes = read_bytes(source)?;
    if serde_json::from_slice::<Value>(&bytes)
        .map(|value| value.is_object())
        .unwrap_or(false)
    {
        return Err(
            "replacement was requested for a configuration that is no longer malformed".into(),
        );
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("cannot create backup timestamp: {error}"))?
        .as_secs();
    let backup = source.with_file_name(format!(
        "{}.invalid-{timestamp}.bak",
        source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(PRIMARY_FILE)
    ));
    fs::copy(source, &backup)
        .map_err(|error| format!("failed to back up {}: {error}", source.display()))?;
    Ok(backup)
}

fn atomic_write_with<F>(target: &Path, contents: &[u8], replace: F) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let parent = target
        .parent()
        .ok_or_else(|| "configuration path has no parent directory".to_string())?;
    let temp = parent.join(format!(".keyri.json.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(contents)?;
        file.flush()?;
        file.sync_all()?;
        replace(&temp, target)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok::<_, io::Error>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|error| format!("failed to save {}: {error}", target.display()))
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, target: &Path) -> io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn save_config_at(home: &Path, request: SaveConfigRequest) -> Result<ConfigSaveResult, String> {
    if !request.config.is_object() {
        return Err("configuration must be a top-level JSON object".into());
    }
    let source = ensure_current_revision(home, request.source_path.as_deref(), &request.revision)?;
    let backup = if let Some(source) = source.as_deref() {
        let bytes = read_bytes(source)?;
        let malformed = serde_json::from_slice::<Value>(&bytes)
            .map(|value| !value.is_object())
            .unwrap_or(true);
        if malformed && !request.replace_invalid {
            return Err(
                "malformed configuration requires explicit replacement confirmation".into(),
            );
        }
        if malformed {
            Some(backup_invalid(source)?)
        } else {
            None
        }
    } else {
        None
    };

    let (primary, _) = paths(home);
    let mut serialized = serde_json::to_vec_pretty(&request.config)
        .map_err(|error| format!("failed to serialize configuration: {error}"))?;
    serialized.push(b'\n');
    atomic_write_with(&primary, &serialized, atomic_replace)?;
    Ok(ConfigSaveResult {
        path: primary.display().to_string(),
        revision: revision_for(&serialized),
        backup_path: backup.map(|path| path.display().to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home() -> PathBuf {
        let path = std::env::temp_dir().join(format!("keyri-config-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn reads_missing_primary_legacy_and_malformed_states() {
        let home = temp_home();
        let missing = read_config_at(&home).unwrap();
        assert_eq!(missing.status, "missing");

        fs::write(home.join(LEGACY_FILE), r#"{"defaultLayout":"corne"}"#).unwrap();
        let legacy = read_config_at(&home).unwrap();
        assert_eq!(legacy.status, "valid");
        assert!(legacy.source_path.unwrap().ends_with(LEGACY_FILE));

        fs::write(home.join(PRIMARY_FILE), "{").unwrap();
        let invalid = read_config_at(&home).unwrap();
        assert_eq!(invalid.status, "invalid");
        assert!(invalid.error.unwrap().contains("invalid JSON"));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn saves_to_primary_and_rejects_revision_conflicts() {
        let home = temp_home();
        fs::write(home.join(LEGACY_FILE), r#"{"defaultLayout":"qwerty"}"#).unwrap();
        let loaded = read_config_at(&home).unwrap();
        let saved = save_config_at(
            &home,
            SaveConfigRequest {
                config: serde_json::json!({"defaultLayout":"corne","future":true}),
                source_path: loaded.source_path.clone(),
                revision: loaded.revision.clone(),
                replace_invalid: false,
            },
        )
        .unwrap();
        assert!(Path::new(&saved.path).ends_with(PRIMARY_FILE));
        assert!(home.join(LEGACY_FILE).exists());
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(home.join(PRIMARY_FILE)).unwrap())
                .unwrap()["future"],
            true
        );

        fs::write(home.join(LEGACY_FILE), "{}").unwrap();
        assert!(save_config_at(
            &home,
            SaveConfigRequest {
                config: serde_json::json!({}),
                source_path: loaded.source_path,
                revision: loaded.revision,
                replace_invalid: false,
            }
        )
        .unwrap_err()
        .contains("changed"));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn malformed_replacement_requires_confirmation_and_creates_backup() {
        let home = temp_home();
        fs::write(home.join(PRIMARY_FILE), "broken json").unwrap();
        let loaded = read_config_at(&home).unwrap();
        let refused = save_config_at(
            &home,
            SaveConfigRequest {
                config: serde_json::json!({"layouts":{"qwerty":true}}),
                source_path: loaded.source_path.clone(),
                revision: loaded.revision.clone(),
                replace_invalid: false,
            },
        );
        assert!(refused.unwrap_err().contains("explicit replacement"));

        let saved = save_config_at(
            &home,
            SaveConfigRequest {
                config: serde_json::json!({"layouts":{"qwerty":true}}),
                source_path: loaded.source_path,
                revision: loaded.revision,
                replace_invalid: true,
            },
        )
        .unwrap();
        let backup = saved.backup_path.unwrap();
        assert_eq!(fs::read_to_string(backup).unwrap(), "broken json");
        assert!(serde_json::from_str::<Value>(
            &fs::read_to_string(home.join(PRIMARY_FILE)).unwrap()
        )
        .is_ok());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn failed_replacement_preserves_existing_file() {
        let home = temp_home();
        let target = home.join(PRIMARY_FILE);
        fs::write(&target, "old contents").unwrap();
        let result = atomic_write_with(&target, b"new contents", |_source, _target| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "simulated failure",
            ))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "old contents");
        fs::remove_dir_all(home).unwrap();
    }
}
