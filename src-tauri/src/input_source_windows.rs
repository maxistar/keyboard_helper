//! Windows input layouts are observed for a foreground thread, never inferred
//! from the language name or keyboard shortcuts. Win32 calls run on a worker.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    ActivateKeyboardLayout, GetKeyboardLayout, GetKeyboardLayoutList, GetKeyboardLayoutNameW, HKL,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, IsWindow, PostMessageW,
    WM_INPUTLANGCHANGEREQUEST,
};

pub fn valid_source_id(id: &str) -> bool {
    id.strip_prefix("windows:klid:").is_some_and(|klid| {
        klid.len() == 8
            && klid != "00000000"
            && klid
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c))
    })
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsConfig {
    pub layout_key: String,
    pub session: String,
    pub source_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsDiagnostics {
    platform: &'static str,
    installed_source_ids: Vec<String>,
    missing_source_ids: Vec<String>,
    context_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsSnapshot {
    layout: String,
    session: String,
    revision: u64,
    current_source_id: Option<String>,
    available_source_ids: Vec<String>,
    diagnostics: WindowsDiagnostics,
    message: Option<String>,
}

type Reply = mpsc::Sender<Result<WindowsSnapshot, String>>;
enum Request {
    Refresh(Reply),
    Select(String, Reply),
}
struct Worker {
    session: String,
    sender: mpsc::Sender<Request>,
    stop: Arc<AtomicBool>,
    handle: std::thread::JoinHandle<()>,
}
#[derive(Default)]
pub struct WindowsInputSourceState {
    worker: Mutex<Option<Worker>>,
}

fn foreground() -> Result<WindowContext, String> {
    WindowContext::read(unsafe { GetForegroundWindow() })
}

fn snapshot(config: &WindowsConfig, revision: u64) -> WindowsSnapshot {
    let mut result = WindowsSnapshot {
        layout: config.layout_key.clone(),
        session: config.session.clone(),
        revision,
        current_source_id: None,
        available_source_ids: vec![],
        message: None,
        diagnostics: WindowsDiagnostics {
            platform: "windows",
            installed_source_ids: vec![],
            missing_source_ids: vec![],
            context_id: None,
        },
    };
    let read = (|| {
        let sources = installed_sources()?;
        result.available_source_ids = sources.keys().cloned().collect();
        result.diagnostics.installed_source_ids = result.available_source_ids.clone();
        result.diagnostics.missing_source_ids = config
            .source_ids
            .iter()
            .filter(|id| !sources.contains_key(*id))
            .cloned()
            .collect();
        let context = foreground()?;
        let source = context.source()?;
        if foreground()? != context {
            return Err("Foreground changed while reading input layout".into());
        }
        // Context identity only; no window titles or typed content are collected.
        result.diagnostics.context_id = Some(format!(
            "{}:{}:{}",
            context.window, context.thread, context.process
        ));
        result.current_source_id = Some(source);
        Ok::<_, String>(())
    })();
    if let Err(error) = read {
        result.message = Some(error);
    }
    result
}

fn select_source(id: &str, stop: &AtomicBool) -> Result<WindowContext, String> {
    let sources = installed_sources()?;
    let handle = *sources
        .get(id)
        .ok_or("Configured Windows layout is not installed")?;
    let context = foreground()?;
    if stop.load(Ordering::SeqCst) {
        return Err("Selection cancelled".into());
    }
    if unsafe {
        PostMessageW(
            context.window as HWND,
            WM_INPUTLANGCHANGEREQUEST,
            0,
            handle as isize,
        )
    } == 0
    {
        return Err(
            "Windows rejected input layout selection (check application permissions)".into(),
        );
    }
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if stop.load(Ordering::SeqCst) || foreground()? != context || !context.validate() {
            return Err("Selection target changed before confirmation".into());
        }
        if context.source()? == id {
            return Ok(context);
        }
        if Instant::now() >= deadline {
            return Err("Windows did not confirm the requested input layout".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

impl WindowsInputSourceState {
    pub fn start(&self, app: AppHandle, config: WindowsConfig) -> Result<WindowsSnapshot, String> {
        if config.source_ids.is_empty() || config.source_ids.iter().any(|id| !valid_source_id(id)) {
            return Err("Invalid Windows source identifiers".into());
        }
        let mut guard = self
            .worker
            .lock()
            .map_err(|_| "Windows worker lock poisoned")?;
        if let Some(old) = guard.take() {
            old.stop.store(true, Ordering::SeqCst);
            drop(old.sender);
            let _ = old.handle.join();
        }
        let (sender, receiver) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let session = config.session.clone();
        let handle = std::thread::spawn(move || {
            let mut revision = 1;
            let mut previous = snapshot(&config, revision);
            let _ = ready_tx.send(previous.clone());
            while !stopped.load(Ordering::SeqCst) {
                let request = receiver.recv_timeout(Duration::from_millis(100));
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                revision += 1;
                match request {
                    Ok(Request::Select(id, reply)) => {
                        let selected = select_source(&id, &stopped);
                        let mut next = snapshot(&config, revision);
                        if let Err(error) = selected {
                            next.current_source_id = None;
                            next.message = Some(error);
                        } else if next.current_source_id.as_deref() != Some(&id)
                            || selected.ok() != foreground().ok()
                        {
                            next.current_source_id = None;
                            next.message =
                                Some("Selection changed before final confirmation".into());
                        }
                        let _ = reply.send(Ok(next.clone()));
                        previous = next;
                    }
                    Ok(Request::Refresh(reply)) => {
                        previous = snapshot(&config, revision);
                        let _ = reply.send(Ok(previous.clone()));
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        let next = snapshot(&config, revision);
                        let mut comparison = previous.clone();
                        comparison.revision = revision;
                        if next != comparison && !stopped.load(Ordering::SeqCst) {
                            let _ = app.emit("windows_input_source_changed", &next);
                        }
                        previous = next;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        *guard = Some(Worker {
            session,
            sender,
            stop,
            handle,
        });
        ready_rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Windows observation startup timed out".into())
    }
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self
            .worker
            .lock()
            .map_err(|_| "Windows worker lock poisoned")?;
        if let Some(worker) = guard.take() {
            worker.stop.store(true, Ordering::SeqCst);
            drop(worker.sender);
            let _ = worker.handle.join();
        }
        Ok(())
    }
    pub fn request(
        &self,
        session: &str,
        source: Option<String>,
    ) -> Result<WindowsSnapshot, String> {
        let (tx, rx) = mpsc::channel();
        {
            let guard = self
                .worker
                .lock()
                .map_err(|_| "Windows worker lock poisoned")?;
            let worker = guard.as_ref().ok_or("Windows observation is not running")?;
            if worker.session != session {
                return Err("Windows selection session changed".into());
            }
            let request = match source {
                Some(id) => Request::Select(id, tx),
                None => Request::Refresh(tx),
            };
            worker
                .sender
                .send(request)
                .map_err(|_| "Windows worker stopped")?;
        }
        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "Windows source request timed out")?
    }
}

impl Drop for WindowsInputSourceState {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

// Resolve an HKL through Windows on this dedicated worker thread. Do not
// assume that HKL bit fields equal a persisted KLID (variants and IMEs differ).
fn source_id(handle: HKL) -> Result<String, String> {
    if handle.is_null() {
        return Err("Windows returned an empty keyboard layout".into());
    }
    unsafe {
        let previous = ActivateKeyboardLayout(handle, 0);
        if previous.is_null() {
            return Err("Cannot resolve the Windows layout identifier".into());
        }
        let mut name = [0u16; 9];
        let success = GetKeyboardLayoutNameW(name.as_mut_ptr());
        let restored = ActivateKeyboardLayout(previous, 0);
        if success == 0 || restored.is_null() {
            return Err("Cannot read or restore the worker layout".into());
        }
        let id = format!(
            "windows:klid:{}",
            String::from_utf16_lossy(&name[..8]).to_uppercase()
        );
        if valid_source_id(&id) {
            Ok(id)
        } else {
            Err("Windows returned an invalid layout identifier".into())
        }
    }
}

fn installed_sources() -> Result<BTreeMap<String, usize>, String> {
    unsafe {
        let count = GetKeyboardLayoutList(0, null_mut());
        if count <= 0 {
            return Err("Windows reports no loaded keyboard layouts".into());
        }
        let mut handles = vec![null_mut(); count as usize];
        let read = GetKeyboardLayoutList(count, handles.as_mut_ptr());
        if read <= 0 {
            return Err("Cannot enumerate Windows keyboard layouts".into());
        }
        let mut sources = BTreeMap::new();
        for handle in handles.into_iter().take(read as usize) {
            let id = source_id(handle)?;
            if let Some(existing) = sources.insert(id, handle as usize) {
                if existing != handle as usize {
                    return Err("Ambiguous Windows layout identifiers".into());
                }
            }
        }
        Ok(sources)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowContext {
    window: usize,
    thread: u32,
    process: u32,
}

impl WindowContext {
    fn read(window: HWND) -> Result<Self, String> {
        unsafe {
            if window.is_null() || IsWindow(window) == 0 {
                return Err("No valid foreground window".into());
            }
            let mut process = 0;
            let thread = GetWindowThreadProcessId(window, &mut process);
            if thread == 0 || process == 0 {
                return Err("Cannot identify foreground context".into());
            }
            Ok(Self {
                window: window as usize,
                thread,
                process,
            })
        }
    }
    fn validate(self) -> bool {
        Self::read(self.window as HWND).ok() == Some(self)
    }
    fn source(self) -> Result<String, String> {
        if !self.validate() {
            return Err("Foreground context no longer exists".into());
        }
        source_id(unsafe { GetKeyboardLayout(self.thread) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_canonical_variant_identifiers() {
        for id in [
            "windows:klid:00000409",
            "windows:klid:00010409",
            "windows:klid:A0000419",
        ] {
            assert!(valid_source_id(id));
        }
        for id in [
            "en",
            "00000409",
            "windows:klid:409",
            "windows:klid:00000000",
            "windows:klid:a0000419",
        ] {
            assert!(!valid_source_id(id));
        }
    }

    #[test]
    #[ignore = "reads layouts from the interactive Windows session"]
    fn reads_installed_and_foreground_layouts() {
        let sources = installed_sources().expect("installed layouts");
        assert!(!sources.is_empty());
        eprintln!(
            "Installed Windows layouts: {:?}",
            sources.keys().collect::<Vec<_>>()
        );
        let context =
            WindowContext::read(unsafe { GetForegroundWindow() }).expect("foreground context");
        let source = context.source().expect("foreground source");
        assert!(valid_source_id(&source));
        eprintln!("Foreground source: {source}");
    }
}
