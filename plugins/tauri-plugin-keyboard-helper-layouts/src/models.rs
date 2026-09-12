use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickResponse {
    pub cancelled: bool,
    pub content: Option<String>,
    pub display_name: Option<String>,
    pub size_bytes: Option<u64>,
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
