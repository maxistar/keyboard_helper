use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickResponse {
    pub cancelled: bool,
    pub kind: Option<String>,
    pub token: Option<String>,
    pub content: Option<String>,
    pub digest: Option<String>,
    #[serde(default)]
    pub assets: Vec<StoredAsset>,
    pub display_name: Option<String>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredAsset {
    pub path: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub digest: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecord {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub digest: String,
    pub content: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub assets: Vec<StoredAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitPackageRequest {
    pub token: String,
    pub record: StoredRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetResponse {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordsResponse {
    pub records: Vec<StoredRecord>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSelection {
    pub schema_version: u32,
    pub source: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectionResponse {
    pub selection: Option<LayoutSelection>,
    pub diagnostic: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_record_defaults_to_no_package_metadata() {
        let record: StoredRecord = serde_json::from_str(r#"{
          "schemaVersion":1,"id":"11111111-1111-4111-8111-111111111111",
          "name":"Legacy","normalizedName":"legacy","digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content":"{}"
        }"#).unwrap();
        assert_eq!(record.format, None);
        assert!(record.assets.is_empty());
    }

    #[test]
    fn package_asset_uses_camel_case_bridge_shape() {
        let asset = StoredAsset {
            path: "assets/key.png".into(), mime_type: "image/png".into(), size_bytes: 4,
            width: 2, height: 2, digest: "b".repeat(64),
        };
        let value = serde_json::to_value(asset).unwrap();
        assert_eq!(value["mimeType"], "image/png");
        assert_eq!(value["sizeBytes"], 4);
    }
}
