use crate::{models::*, KeyboardHelperLayoutsExt, Result};
use tauri::{command, AppHandle, Runtime};

#[command]
pub(crate) async fn pick_layout<R: Runtime>(app: AppHandle<R>) -> Result<PickResponse> {
    app.keyboard_helper_layouts().pick_layout()
}
#[command]
pub(crate) async fn list_records<R: Runtime>(app: AppHandle<R>) -> Result<RecordsResponse> {
    app.keyboard_helper_layouts().list_records()
}
#[command]
pub(crate) async fn write_record<R: Runtime>(
    app: AppHandle<R>,
    record: StoredRecord,
) -> Result<()> {
    app.keyboard_helper_layouts().write_record(record)
}
#[command]
pub(crate) async fn commit_package<R: Runtime>(app: AppHandle<R>, token: String, record: StoredRecord) -> Result<()> {
    app.keyboard_helper_layouts().commit_package(token, record)
}
#[command]
pub(crate) async fn discard_package<R: Runtime>(app: AppHandle<R>, token: String) -> Result<()> {
    app.keyboard_helper_layouts().discard_package(token)
}
#[command]
pub(crate) async fn read_asset<R: Runtime>(app: AppHandle<R>, id: String, path: String) -> Result<AssetResponse> {
    app.keyboard_helper_layouts().read_asset(id, path)
}
#[command]
pub(crate) async fn remove_record<R: Runtime>(app: AppHandle<R>, id: String) -> Result<()> {
    app.keyboard_helper_layouts().remove_record(id)
}
#[command]
pub(crate) async fn read_selection<R: Runtime>(app: AppHandle<R>) -> Result<SelectionResponse> {
    app.keyboard_helper_layouts().read_selection()
}
#[command]
pub(crate) async fn write_selection<R: Runtime>(
    app: AppHandle<R>,
    selection: LayoutSelection,
) -> Result<()> {
    app.keyboard_helper_layouts().write_selection(selection)
}
