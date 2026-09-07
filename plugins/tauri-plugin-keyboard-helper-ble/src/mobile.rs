use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{models::*, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<KeyboardHelperBle<R>> {
    let handle =
        api.register_android_plugin("me.maxistar.keyboardhelper.ble", "KeyboardHelperBlePlugin")?;
    Ok(KeyboardHelperBle(handle))
}

pub(crate) struct KeyboardHelperBle<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> KeyboardHelperBle<R> {
    pub(crate) fn permission_status(&self) -> Result<PermissionStatus> {
        Ok(self.0.run_mobile_plugin("permissionStatus", ())?)
    }

    pub(crate) fn request_permissions(&self) -> Result<PermissionStatus> {
        Ok(self.0.run_mobile_plugin("requestBlePermissions", ())?)
    }

    pub(crate) fn start_scan(&self, request: StartScanRequest) -> Result<()> {
        Ok(self.0.run_mobile_plugin("startScan", request)?)
    }

    pub(crate) fn stop_scan(&self) -> Result<()> {
        Ok(self.0.run_mobile_plugin("stopScan", ())?)
    }

    pub(crate) fn connect(&self, request: ConnectRequest) -> Result<()> {
        Ok(self.0.run_mobile_plugin("connect", request)?)
    }

    pub(crate) fn list_services(&self, request: AttemptRequest) -> Result<Vec<Service>> {
        let response: ServicesResponse = self.0.run_mobile_plugin("listServices", request)?;
        Ok(response.services)
    }

    pub(crate) fn read(&self, request: GattRequest) -> Result<Vec<u8>> {
        let response: BytesResponse = self.0.run_mobile_plugin("read", request)?;
        Ok(response.bytes)
    }

    pub(crate) fn subscribe(&self, request: SubscribeRequest) -> Result<()> {
        Ok(self.0.run_mobile_plugin("subscribe", request)?)
    }

    pub(crate) fn unsubscribe(&self, request: GattRequest) -> Result<()> {
        Ok(self.0.run_mobile_plugin("unsubscribe", request)?)
    }

    pub(crate) fn disconnect(&self, request: AttemptRequest) -> Result<()> {
        Ok(self.0.run_mobile_plugin("disconnect", request)?)
    }
}
