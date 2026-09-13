use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{models::*, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<KeyboardHelperLayouts<R>> {
    let handle = api.register_android_plugin(
        "me.maxistar.keyboardhelper.layouts",
        "KeyboardHelperLayoutsPlugin",
    )?;
    Ok(KeyboardHelperLayouts(handle))
}

pub(crate) struct KeyboardHelperLayouts<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> KeyboardHelperLayouts<R> {
    pub(crate) fn pick_layout(&self) -> Result<PickResponse> {
        Ok(self.0.run_mobile_plugin("pickLayout", ())?)
    }
    pub(crate) fn list_records(&self) -> Result<RecordsResponse> {
        Ok(self.0.run_mobile_plugin("listRecords", ())?)
    }
    pub(crate) fn write_record(&self, record: StoredRecord) -> Result<()> {
        Ok(self.0.run_mobile_plugin("writeRecord", record)?)
    }
    pub(crate) fn remove_record(&self, id: String) -> Result<()> {
        Ok(self.0.run_mobile_plugin("removeRecord", IdRequest { id })?)
    }
    pub(crate) fn read_selection(&self) -> Result<SelectionResponse> {
        Ok(self.0.run_mobile_plugin("readSelection", ())?)
    }
    pub(crate) fn write_selection(&self, selection: LayoutSelection) -> Result<()> {
        Ok(self.0.run_mobile_plugin("writeSelection", selection)?)
    }
}

#[derive(serde::Serialize)]
struct IdRequest {
    id: String,
}
