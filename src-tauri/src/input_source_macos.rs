use core_foundation_sys::array::{CFArrayGetCount, CFArrayGetValueAtIndex, CFArrayRef};
use core_foundation_sys::base::{Boolean, CFRelease};
use core_foundation_sys::dictionary::CFDictionaryRef;
use core_foundation_sys::notification_center::{
    CFNotificationCenterAddObserver, CFNotificationCenterGetDistributedCenter,
    CFNotificationCenterRef, CFNotificationCenterRemoveObserver,
    CFNotificationSuspensionBehaviorDeliverImmediately,
};
use core_foundation_sys::string::{
    kCFStringEncodingUTF8, CFStringGetCString, CFStringGetLength,
    CFStringGetMaximumSizeForEncoding, CFStringRef,
};
use serde::Serialize;
use std::collections::HashSet;
use std::ffi::{c_void, CStr};
use std::os::raw::c_char;
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

type TISInputSourceRef = *const c_void;

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn TISCopyCurrentKeyboardInputSource() -> TISInputSourceRef;
    fn TISCreateInputSourceList(
        properties: CFDictionaryRef,
        include_all_installed: Boolean,
    ) -> CFArrayRef;
    fn TISGetInputSourceProperty(
        input_source: TISInputSourceRef,
        property_key: CFStringRef,
    ) -> *const c_void;
    fn TISSelectInputSource(input_source: TISInputSourceRef) -> i32;

    static kTISPropertyInputSourceID: CFStringRef;
    static kTISNotifySelectedKeyboardInputSourceChanged: CFStringRef;
}

#[derive(Default)]
pub struct MacosInputSourceState {
    generation: Arc<AtomicU64>,
    observer: Mutex<Option<ObserverRegistration>>,
    allowed_source_ids: Mutex<HashSet<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSourceSnapshot {
    pub current_source_id: Option<String>,
    pub available_source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputSourceChangedPayload {
    layout: String,
    source_id: String,
}

struct ObserverContext {
    app_handle: AppHandle,
    generation: Arc<AtomicU64>,
    expected_generation: u64,
    layout_key: String,
}

struct ObserverRegistration {
    center: CFNotificationCenterRef,
    context: *mut ObserverContext,
}

// The registration is created, used, and destroyed behind a Mutex. Core Foundation retains
// neither the observer pointer nor its Rust allocation, so Drop unregisters before freeing it.
unsafe impl Send for ObserverRegistration {}

impl Drop for ObserverRegistration {
    fn drop(&mut self) {
        unsafe {
            CFNotificationCenterRemoveObserver(
                self.center,
                self.context.cast(),
                kTISNotifySelectedKeyboardInputSourceChanged,
                ptr::null(),
            );
            drop(Box::from_raw(self.context));
        }
    }
}

impl MacosInputSourceState {
    pub fn start(
        &self,
        app_handle: AppHandle,
        layout_key: String,
        configured_source_ids: Vec<String>,
    ) -> Result<InputSourceSnapshot, String> {
        let snapshot = snapshot()?;
        let configured: HashSet<String> = configured_source_ids.into_iter().collect();
        let available: HashSet<&str> = snapshot
            .available_source_ids
            .iter()
            .map(String::as_str)
            .collect();
        let allowed = configured
            .into_iter()
            .filter(|source_id| available.contains(source_id.as_str()))
            .collect();
        *self
            .allowed_source_ids
            .lock()
            .map_err(|error| error.to_string())? = allowed;

        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let context = Box::new(ObserverContext {
            app_handle,
            generation: self.generation.clone(),
            expected_generation: generation,
            layout_key,
        });
        let context = Box::into_raw(context);
        let center = unsafe { CFNotificationCenterGetDistributedCenter() };
        if center.is_null() {
            unsafe { drop(Box::from_raw(context)) };
            return Err("macOS distributed notification center is unavailable".into());
        }

        unsafe {
            CFNotificationCenterAddObserver(
                center,
                context.cast(),
                input_source_changed,
                kTISNotifySelectedKeyboardInputSourceChanged,
                ptr::null(),
                CFNotificationSuspensionBehaviorDeliverImmediately,
            );
        }

        let registration = ObserverRegistration { center, context };
        *self.observer.lock().map_err(|error| error.to_string())? = Some(registration);
        Ok(snapshot)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.observer
            .lock()
            .map_err(|error| error.to_string())?
            .take();
        self.allowed_source_ids
            .lock()
            .map_err(|error| error.to_string())?
            .clear();
        Ok(())
    }

    pub fn select(&self, source_id: &str) -> Result<(), String> {
        let allowed = self
            .allowed_source_ids
            .lock()
            .map_err(|error| error.to_string())?;
        if !allowed.contains(source_id) {
            return Err(format!(
                "input source '{source_id}' is not available for the active layout"
            ));
        }
        select_source(source_id)
    }

    pub fn snapshot(&self) -> Result<InputSourceSnapshot, String> {
        snapshot()
    }
}

extern "C" fn input_source_changed(
    _center: CFNotificationCenterRef,
    observer: *mut c_void,
    _name: CFStringRef,
    _object: *const c_void,
    _user_info: CFDictionaryRef,
) {
    if observer.is_null() {
        return;
    }
    let context = unsafe { &*(observer.cast::<ObserverContext>()) };
    if context.generation.load(Ordering::SeqCst) != context.expected_generation {
        return;
    }
    let Ok(Some(source_id)) = current_source_id() else {
        return;
    };
    let _ = context.app_handle.emit(
        "macos_input_source_changed",
        InputSourceChangedPayload {
            layout: context.layout_key.clone(),
            source_id,
        },
    );
}

fn snapshot() -> Result<InputSourceSnapshot, String> {
    Ok(InputSourceSnapshot {
        current_source_id: current_source_id()?,
        available_source_ids: available_source_ids()?,
    })
}

fn current_source_id() -> Result<Option<String>, String> {
    let source = unsafe { TISCopyCurrentKeyboardInputSource() };
    if source.is_null() {
        return Ok(None);
    }
    let result = input_source_id(source);
    unsafe { CFRelease(source.cast()) };
    Ok(result)
}

fn available_source_ids() -> Result<Vec<String>, String> {
    let sources = unsafe { TISCreateInputSourceList(ptr::null(), 0) };
    if sources.is_null() {
        return Err("macOS did not return an input source list".into());
    }

    let mut ids = Vec::new();
    let count = unsafe { CFArrayGetCount(sources) };
    for index in 0..count {
        let source = unsafe { CFArrayGetValueAtIndex(sources, index) };
        if let Some(id) = input_source_id(source) {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    unsafe { CFRelease(sources.cast()) };
    Ok(ids)
}

fn select_source(source_id: &str) -> Result<(), String> {
    let sources = unsafe { TISCreateInputSourceList(ptr::null(), 0) };
    if sources.is_null() {
        return Err("macOS did not return an input source list".into());
    }

    let count = unsafe { CFArrayGetCount(sources) };
    let mut result = Err(format!("macOS input source '{source_id}' is not installed"));
    for index in 0..count {
        let source = unsafe { CFArrayGetValueAtIndex(sources, index) };
        if input_source_id(source).as_deref() == Some(source_id) {
            let status = unsafe { TISSelectInputSource(source) };
            result = if status == 0 {
                Ok(())
            } else {
                Err(format!(
                    "macOS rejected input source '{source_id}' with status {status}"
                ))
            };
            break;
        }
    }
    unsafe { CFRelease(sources.cast()) };
    result
}

fn input_source_id(source: TISInputSourceRef) -> Option<String> {
    if source.is_null() {
        return None;
    }
    let value = unsafe { TISGetInputSourceProperty(source, kTISPropertyInputSourceID) };
    cf_string_to_string(value.cast())
}

fn cf_string_to_string(value: CFStringRef) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let length = unsafe { CFStringGetLength(value) };
    let capacity = unsafe { CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) } + 1;
    if capacity <= 0 {
        return None;
    }
    let mut buffer = vec![0_u8; capacity as usize];
    let converted = unsafe {
        CFStringGetCString(
            value,
            buffer.as_mut_ptr().cast::<c_char>(),
            capacity,
            kCFStringEncodingUTF8,
        )
    };
    if converted == 0 {
        return None;
    }
    unsafe { CStr::from_ptr(buffer.as_ptr().cast::<c_char>()) }
        .to_str()
        .ok()
        .map(str::to_owned)
}
