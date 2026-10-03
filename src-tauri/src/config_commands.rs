use crate::config_store;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Emitter;

#[tauri::command]
pub(crate) fn read_config_state() -> Result<config_store::ConfigReadResult, String> {
    config_store::read_config_at(&config_store::resolve_home()?)
}

#[tauri::command]
pub(crate) fn save_config(
    app_handle: tauri::AppHandle,
    request: config_store::SaveConfigRequest,
) -> Result<config_store::ConfigSaveResult, String> {
    let result = config_store::save_config_at(&config_store::resolve_home()?, request)?;
    app_handle
        .emit_to("overlay", "app-settings-saved", &result)
        .map_err(|error| {
            format!("settings were saved but the overlay could not be notified: {error}")
        })?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn read_layout_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    read_bounded_layout_file(&path_buf)
}

const MAX_LAYOUT_DOCUMENT_BYTES: u64 = 1_048_576;

fn read_bounded_layout_file(path: &Path) -> Result<String, String> {
    let file =
        std::fs::File::open(path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    read_bounded_layout(file)
}

fn read_bounded_layout(reader: impl Read) -> Result<String, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_LAYOUT_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("failed to read layout document: {e}"))?;
    if bytes.len() as u64 > MAX_LAYOUT_DOCUMENT_BYTES {
        return Err("layout document is larger than 1 MiB".into());
    }
    String::from_utf8(bytes).map_err(|_| "layout document is not valid UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::read_bounded_layout;
    use std::io::Cursor;

    #[test]
    fn layout_reader_rejects_documents_larger_than_one_mibibyte() {
        assert!(read_bounded_layout(Cursor::new(vec![b'a'; 1_048_576])).is_ok());
        assert!(read_bounded_layout(Cursor::new(vec![b'a'; 1_048_577])).is_err());
    }
}
