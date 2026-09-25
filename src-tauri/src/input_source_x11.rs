use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::{c_void, CStr, CString};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use x11::xlib;

const XKB_USE_CORE_KBD: u32 = 0x0100;
const XKB_GROUP_NAMES_MASK: u32 = 1 << 12;
const XKB_ALL_CONTROLS_MASK: u64 = 0xF800_1FFF;
const XKB_SELECTION_TIMEOUT: Duration = Duration::from_millis(1_000);
const XKB_WORKER_POLL: Duration = Duration::from_millis(20);
const X11_BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct X11InputSourceSyncConfig {
    pub layout_key: String,
    pub source_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct X11GroupDiagnostic {
    pub group_index: u32,
    pub group_name: String,
    pub layout: Option<String>,
    pub variant: Option<String>,
    pub identifiers: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct X11InputSourceDiagnostics {
    pub session_type: String,
    pub display: Option<String>,
    pub follows_xkb_only: bool,
    pub groups: Vec<X11GroupDiagnostic>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct X11InputSourceSnapshot {
    pub current_source_id: Option<String>,
    pub available_source_ids: Vec<String>,
    pub diagnostics: X11InputSourceDiagnostics,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct X11InputSourceError {
    pub reason: String,
    pub message: String,
    pub diagnostics: Option<X11InputSourceDiagnostics>,
}

impl X11InputSourceError {
    fn new(reason: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            message: message.into(),
            diagnostics: None,
        }
    }

    fn with_diagnostics(mut self, diagnostics: X11InputSourceDiagnostics) -> Self {
        self.diagnostics = Some(diagnostics);
        self
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct X11InputSourceChangedPayload {
    layout: String,
    source_id: Option<String>,
    available_source_ids: Vec<String>,
    diagnostics: X11InputSourceDiagnostics,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionClassification {
    label: String,
    display: String,
}

#[derive(Default)]
struct RuntimeSnapshot {
    layout_key: Option<String>,
    configured_source_ids: Vec<String>,
    source_to_group: HashMap<String, u32>,
    current_source_id: Option<String>,
    available_source_ids: Vec<String>,
    diagnostics: Option<X11InputSourceDiagnostics>,
}

struct WorkerRegistration {
    stop: Arc<AtomicBool>,
    wake: Arc<(Mutex<bool>, Condvar)>,
    handle: Option<JoinHandle<()>>,
}

trait XkbLifecycleBackend {
    fn subscribe(&mut self) -> Result<i32, X11InputSourceError>;
    fn current_group(&mut self) -> Result<u32, X11InputSourceError>;
    fn lock_group(&mut self, group: u32) -> Result<(), X11InputSourceError>;
}

struct NativeXkbBackend {
    display: *mut xlib::Display,
}

impl XkbLifecycleBackend for NativeXkbBackend {
    fn subscribe(&mut self) -> Result<i32, X11InputSourceError> {
        initialize_xkb(self.display)
    }

    fn current_group(&mut self) -> Result<u32, X11InputSourceError> {
        read_current_group(self.display)
    }

    fn lock_group(&mut self, group: u32) -> Result<(), X11InputSourceError> {
        if unsafe { xlib::XkbLockGroup(self.display, XKB_USE_CORE_KBD, group) } == 0 {
            return Err(X11InputSourceError::new(
                "selection-rejected",
                format!("XKB rejected group {group}"),
            ));
        }
        unsafe { xlib::XFlush(self.display) };
        Ok(())
    }
}

fn bootstrap_backend(
    backend: &mut impl XkbLifecycleBackend,
) -> Result<(i32, u32), X11InputSourceError> {
    let event_base = backend.subscribe()?;
    let current_group = backend.current_group()?;
    Ok((event_base, current_group))
}

fn generation_is_current(shared_generation: &AtomicU64, generation: u64) -> bool {
    shared_generation.load(Ordering::SeqCst) == generation
}

fn select_and_confirm_backend(
    backend: &mut impl XkbLifecycleBackend,
    target_group: u32,
    source_id: &str,
    timeout: Duration,
    poll: Duration,
) -> Result<(), X11InputSourceError> {
    backend.lock_group(target_group).map_err(|mut error| {
        error.message = format!("XKB rejected source '{source_id}'");
        error
    })?;
    let deadline = Instant::now() + timeout;
    loop {
        if backend.current_group()? == target_group {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(X11InputSourceError::new(
                "selection-timeout",
                format!(
                    "XKB did not confirm source '{source_id}' within {} ms",
                    timeout.as_millis()
                ),
            ));
        }
        thread::sleep(poll);
    }
}

impl WorkerRegistration {
    fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let (wake_lock, wake_signal) = &*self.wake;
        if let Ok(mut wake_requested) = wake_lock.lock() {
            *wake_requested = true;
            wake_signal.notify_all();
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Default)]
pub struct X11InputSourceState {
    generation: Arc<AtomicU64>,
    runtime: Arc<Mutex<RuntimeSnapshot>>,
    worker: Mutex<Option<WorkerRegistration>>,
}

impl X11InputSourceState {
    pub fn start(
        &self,
        app_handle: AppHandle,
        config: X11InputSourceSyncConfig,
    ) -> Result<X11InputSourceSnapshot, X11InputSourceError> {
        self.stop()?;
        let session = classify_current_session()?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let wake = Arc::new((Mutex::new(false), Condvar::new()));
        let worker_wake = wake.clone();
        let shared_generation = self.generation.clone();
        let runtime = self.runtime.clone();
        let layout_key = config.layout_key.clone();
        let configured_source_ids = config.source_ids.clone();
        let (sender, receiver) = mpsc::sync_channel(1);

        let handle = thread::spawn(move || {
            run_worker(
                app_handle,
                layout_key,
                configured_source_ids,
                session,
                generation,
                shared_generation,
                worker_stop,
                worker_wake,
                runtime,
                sender,
            );
        });

        let registration = WorkerRegistration {
            stop,
            wake,
            handle: Some(handle),
        };
        let bootstrap = receiver.recv_timeout(X11_BOOTSTRAP_TIMEOUT).map_err(|_| {
            X11InputSourceError::new(
                "startup-timeout",
                "X11/XKB adapter did not finish startup in time",
            )
        })?;

        match bootstrap {
            Ok(snapshot) => {
                *self.worker.lock().map_err(lock_error)? = Some(registration);
                Ok(snapshot)
            }
            Err(error) => {
                registration.stop();
                Err(error)
            }
        }
    }

    pub fn stop(&self) -> Result<(), X11InputSourceError> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(worker) = self.worker.lock().map_err(lock_error)?.take() {
            worker.stop();
        }
        *self.runtime.lock().map_err(lock_error)? = RuntimeSnapshot::default();
        Ok(())
    }

    pub fn refresh(&self) -> Result<X11InputSourceSnapshot, X11InputSourceError> {
        let (layout_key, configured_source_ids) = {
            let runtime = self.runtime.lock().map_err(lock_error)?;
            (
                runtime.layout_key.clone().ok_or_else(|| {
                    X11InputSourceError::new("not-started", "X11/XKB adapter is not started")
                })?,
                runtime.configured_source_ids.clone(),
            )
        };
        let session = classify_current_session()?;
        let snapshot = query_snapshot(&session, &configured_source_ids)?;
        store_snapshot(
            &self.runtime,
            &layout_key,
            &configured_source_ids,
            &snapshot,
        )?;
        Ok(snapshot)
    }

    pub fn select(&self, source_id: &str) -> Result<(), X11InputSourceError> {
        let target_group = self
            .runtime
            .lock()
            .map_err(lock_error)?
            .source_to_group
            .get(source_id)
            .copied()
            .ok_or_else(|| {
                X11InputSourceError::new(
                    "unavailable-group",
                    format!("XKB source '{source_id}' is unavailable for the active layout"),
                )
            })?;
        let session = classify_current_session()?;
        select_group(&session, target_group, source_id)
    }
}

impl Drop for X11InputSourceState {
    fn drop(&mut self) {
        if let Ok(worker) = self.worker.get_mut() {
            if let Some(worker) = worker.take() {
                worker.stop();
            }
        }
    }
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> X11InputSourceError {
    X11InputSourceError::new("state-poisoned", error.to_string())
}

fn classify_current_session() -> Result<SessionClassification, X11InputSourceError> {
    classify_session(
        env::var("XDG_SESSION_TYPE").ok().as_deref(),
        env::var("DISPLAY").ok().as_deref(),
        env::var("WAYLAND_DISPLAY").ok().as_deref(),
    )
}

fn classify_session(
    session_type: Option<&str>,
    display: Option<&str>,
    wayland_display: Option<&str>,
) -> Result<SessionClassification, X11InputSourceError> {
    let session = session_type.unwrap_or_default().trim().to_ascii_lowercase();
    let display = display.filter(|value| !value.trim().is_empty());
    let wayland = wayland_display.filter(|value| !value.trim().is_empty());

    if session == "wayland" {
        return Err(X11InputSourceError::new(
            "wayland-session",
            "X11 Input Source Sync is unavailable in a Wayland/XWayland session",
        ));
    }
    if !session.is_empty() && session != "x11" {
        return Err(X11InputSourceError::new(
            "unsupported-session",
            format!("X11 Input Source Sync is unavailable in the '{session}' session type"),
        ));
    }
    let display = display.ok_or_else(|| {
        X11InputSourceError::new(
            "missing-display",
            "X11 Input Source Sync requires the DISPLAY environment variable",
        )
    })?;
    if session.is_empty() && wayland.is_some() {
        return Err(X11InputSourceError::new(
            "wayland-session",
            "X11 Input Source Sync will not use an unclassified XWayland display",
        ));
    }
    Ok(SessionClassification {
        label: if session == "x11" {
            "x11".into()
        } else {
            "x11-unclassified".into()
        },
        display: display.to_owned(),
    })
}

fn run_worker(
    app_handle: AppHandle,
    layout_key: String,
    configured_source_ids: Vec<String>,
    session: SessionClassification,
    generation: u64,
    shared_generation: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    wake: Arc<(Mutex<bool>, Condvar)>,
    runtime: Arc<Mutex<RuntimeSnapshot>>,
    bootstrap_sender: mpsc::SyncSender<Result<X11InputSourceSnapshot, X11InputSourceError>>,
) {
    let display = match open_display(&session) {
        Ok(display) => display,
        Err(error) => {
            let _ = bootstrap_sender.send(Err(error));
            return;
        }
    };

    let mut backend = NativeXkbBackend { display };
    let (event_base, current_group) = match bootstrap_backend(&mut backend) {
        Ok(bootstrap) => bootstrap,
        Err(error) => {
            unsafe { xlib::XCloseDisplay(display) };
            let _ = bootstrap_sender.send(Err(error));
            return;
        }
    };

    let initial =
        discover_snapshot_for_group(display, &session, &configured_source_ids, current_group);
    let initial = match initial {
        Ok(snapshot) => snapshot,
        Err(error) => {
            unsafe { xlib::XCloseDisplay(display) };
            let _ = bootstrap_sender.send(Err(error));
            return;
        }
    };
    if let Err(error) = store_snapshot(&runtime, &layout_key, &configured_source_ids, &initial) {
        unsafe { xlib::XCloseDisplay(display) };
        let _ = bootstrap_sender.send(Err(error));
        return;
    }
    if bootstrap_sender.send(Ok(initial)).is_err() {
        unsafe { xlib::XCloseDisplay(display) };
        return;
    }

    while !stop.load(Ordering::SeqCst) && generation_is_current(&shared_generation, generation) {
        let mut handled_event = false;
        while unsafe { xlib::XPending(display) } > 0 {
            handled_event = true;
            let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
            unsafe { xlib::XNextEvent(display, &mut event) };
            if event.get_type() != event_base {
                continue;
            }
            let xkb_event =
                unsafe { &*((&event as *const xlib::XEvent).cast::<xlib::XkbStateNotifyEvent>()) };
            if xkb_event.xkb_type != xlib::XkbStateNotify
                && xkb_event.xkb_type != xlib::XkbNamesNotify
            {
                continue;
            }
            if let Ok(snapshot) = discover_snapshot(display, &session, &configured_source_ids) {
                if store_snapshot(&runtime, &layout_key, &configured_source_ids, &snapshot).is_ok()
                    && generation_is_current(&shared_generation, generation)
                {
                    let _ = app_handle.emit(
                        "x11_input_source_changed",
                        X11InputSourceChangedPayload {
                            layout: layout_key.clone(),
                            source_id: snapshot.current_source_id,
                            available_source_ids: snapshot.available_source_ids,
                            diagnostics: snapshot.diagnostics,
                        },
                    );
                }
            }
        }
        if !handled_event {
            let (wake_lock, wake_signal) = &*wake;
            if let Ok(mut wake_requested) = wake_lock.lock() {
                if !*wake_requested {
                    if let Ok((guard, _)) =
                        wake_signal.wait_timeout(wake_requested, XKB_WORKER_POLL)
                    {
                        wake_requested = guard;
                    } else {
                        continue;
                    }
                }
                *wake_requested = false;
            }
        }
    }
    unsafe { xlib::XCloseDisplay(display) };
}

fn query_snapshot(
    session: &SessionClassification,
    configured_source_ids: &[String],
) -> Result<X11InputSourceSnapshot, X11InputSourceError> {
    let display = open_display(session)?;
    let result = initialize_xkb(display)
        .and_then(|_| discover_snapshot(display, session, configured_source_ids));
    unsafe { xlib::XCloseDisplay(display) };
    result
}

fn open_display(
    session: &SessionClassification,
) -> Result<*mut xlib::Display, X11InputSourceError> {
    let display_name = CString::new(session.display.as_str()).map_err(|_| {
        X11InputSourceError::new("invalid-display", "DISPLAY contains an embedded NUL byte")
    })?;
    let display = unsafe { xlib::XOpenDisplay(display_name.as_ptr()) };
    if display.is_null() {
        return Err(X11InputSourceError::new(
            "display-open-failed",
            format!("Cannot open X11 display '{}'", session.display),
        ));
    }
    Ok(display)
}

fn initialize_xkb(display: *mut xlib::Display) -> Result<i32, X11InputSourceError> {
    let mut opcode = 0;
    let mut event_base = 0;
    let mut error_base = 0;
    let mut major = 1;
    let mut minor = 0;
    let available = unsafe {
        xlib::XkbQueryExtension(
            display,
            &mut opcode,
            &mut event_base,
            &mut error_base,
            &mut major,
            &mut minor,
        )
    };
    if available == 0 {
        return Err(X11InputSourceError::new(
            "xkb-unavailable",
            "The X11 display does not expose the XKB extension",
        ));
    }
    let event_mask = xlib::XkbStateNotifyMask | xlib::XkbNamesNotifyMask;
    if unsafe { xlib::XkbSelectEvents(display, XKB_USE_CORE_KBD, event_mask, event_mask) } == 0
        || unsafe {
            xlib::XkbSelectEventDetails(
                display,
                XKB_USE_CORE_KBD,
                xlib::XkbStateNotify as u32,
                xlib::XkbGroupStateMask,
                xlib::XkbGroupStateMask,
            )
        } == 0
    {
        return Err(X11InputSourceError::new(
            "xkb-subscription-failed",
            "Failed to subscribe to XKB group state changes",
        ));
    }
    unsafe { xlib::XFlush(display) };
    Ok(event_base)
}

fn discover_snapshot(
    display: *mut xlib::Display,
    session: &SessionClassification,
    configured_source_ids: &[String],
) -> Result<X11InputSourceSnapshot, X11InputSourceError> {
    let current_group = read_current_group(display)?;
    discover_snapshot_for_group(display, session, configured_source_ids, current_group)
}

fn discover_snapshot_for_group(
    display: *mut xlib::Display,
    session: &SessionClassification,
    configured_source_ids: &[String],
    current_group: u32,
) -> Result<X11InputSourceSnapshot, X11InputSourceError> {
    let groups = read_groups(display, current_group)?;
    let diagnostics = X11InputSourceDiagnostics {
        session_type: session.label.clone(),
        display: Some(session.display.clone()),
        follows_xkb_only: true,
        groups,
    };
    let source_to_group = resolve_sources(configured_source_ids, &diagnostics.groups)
        .map_err(|error| error.with_diagnostics(diagnostics.clone()))?;
    let mut available_source_ids: Vec<String> = configured_source_ids
        .iter()
        .filter(|source_id| source_to_group.contains_key(*source_id))
        .cloned()
        .collect();
    available_source_ids.dedup();
    let current_source_id = source_id_for_group(
        current_group,
        configured_source_ids,
        &source_to_group,
        &diagnostics.groups,
    );
    Ok(X11InputSourceSnapshot {
        current_source_id,
        available_source_ids,
        diagnostics,
    })
}

fn store_snapshot(
    runtime: &Arc<Mutex<RuntimeSnapshot>>,
    layout_key: &str,
    configured_source_ids: &[String],
    snapshot: &X11InputSourceSnapshot,
) -> Result<(), X11InputSourceError> {
    let source_to_group = resolve_sources(configured_source_ids, &snapshot.diagnostics.groups)
        .map_err(|error| error.with_diagnostics(snapshot.diagnostics.clone()))?;
    let mut current = runtime.lock().map_err(lock_error)?;
    current.layout_key = Some(layout_key.to_owned());
    current.configured_source_ids = configured_source_ids.to_vec();
    current.source_to_group = source_to_group;
    current.current_source_id = snapshot.current_source_id.clone();
    current.available_source_ids = snapshot.available_source_ids.clone();
    current.diagnostics = Some(snapshot.diagnostics.clone());
    Ok(())
}

fn read_current_group(display: *mut xlib::Display) -> Result<u32, X11InputSourceError> {
    let mut state: xlib::XkbStateRec = unsafe { std::mem::zeroed() };
    let status = unsafe { xlib::XkbGetState(display, XKB_USE_CORE_KBD, &mut state) };
    if status != xlib::Success as i32 {
        return Err(X11InputSourceError::new(
            "xkb-state-unavailable",
            format!("XkbGetState failed with status {status}"),
        ));
    }
    Ok(state.group as u32)
}

fn read_groups(
    display: *mut xlib::Display,
    current_group: u32,
) -> Result<Vec<X11GroupDiagnostic>, X11InputSourceError> {
    // Some X servers (including Xubuntu's Xorg setup) reject the convenience
    // XkbGetKeyboard call when name metadata is requested. Build the descriptor
    // incrementally so group discovery still works on those servers.
    let keyboard = unsafe { xlib::XkbGetMap(display, 0, XKB_USE_CORE_KBD) };
    if !keyboard.is_null() {
        unsafe {
            xlib::XkbGetNames(display, XKB_GROUP_NAMES_MASK, keyboard);
            xlib::XkbGetControls(display, XKB_ALL_CONTROLS_MASK, keyboard);
        }
    }

    let mut count = current_group.saturating_add(1).min(4) as usize;
    let controls = unsafe { (*keyboard).ctrls };
    if !controls.is_null() {
        count = count.max(unsafe { (*controls).num_groups as usize }.min(4));
    }
    let names = unsafe { (*keyboard).names };
    if !names.is_null() {
        for (index, atom) in unsafe { (*names).groups }.iter().enumerate() {
            if *atom != 0 {
                count = count.max(index + 1);
            }
        }
    }

    let rules = read_rules_names(display)?;
    if let Some((layouts, _)) = &rules {
        count = count.max(layouts.len().min(4));
    }
    count = count.clamp(1, 4);

    let stable_metadata_valid = rules
        .as_ref()
        .map(|(layouts, variants)| layouts.len() == count && variants.len() == count)
        .unwrap_or(false);
    let mut groups = Vec::with_capacity(count);
    for index in 0..count {
        let group_name = if !names.is_null() {
            atom_name(display, unsafe { (*names).groups[index] })
        } else {
            None
        }
        .unwrap_or_else(|| format!("Group {index}"));
        let (layout, variant) = if stable_metadata_valid {
            let (layouts, variants) = rules.as_ref().expect("validated rules metadata");
            (
                non_empty(layouts[index].clone()),
                non_empty(variants[index].clone()),
            )
        } else {
            (None, None)
        };
        let mut identifiers = vec![format!("xkb:group:{index}")];
        if let Some(layout) = layout.as_deref() {
            let stable = canonical_layout_id(layout, variant.as_deref())?;
            identifiers.insert(0, stable);
        }
        groups.push(X11GroupDiagnostic {
            group_index: index as u32,
            group_name,
            layout,
            variant,
            identifiers,
        });
    }
    if !keyboard.is_null() {
        unsafe { xlib::XkbFreeKeyboard(keyboard, 0, 1) };
    }
    Ok(groups)
}

fn non_empty(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn atom_name(display: *mut xlib::Display, atom: xlib::Atom) -> Option<String> {
    if atom == 0 {
        return None;
    }
    let name = unsafe { xlib::XGetAtomName(display, atom) };
    if name.is_null() {
        return None;
    }
    let result = unsafe { CStr::from_ptr(name) }
        .to_string_lossy()
        .into_owned();
    unsafe { xlib::XFree(name.cast::<c_void>()) };
    Some(result)
}

fn read_rules_names(
    display: *mut xlib::Display,
) -> Result<Option<(Vec<String>, Vec<String>)>, X11InputSourceError> {
    let property_name = CString::new("_XKB_RULES_NAMES").expect("static property name");
    let property = unsafe { xlib::XInternAtom(display, property_name.as_ptr(), 1) };
    if property == 0 {
        return Ok(None);
    }
    let mut actual_type = 0;
    let mut actual_format = 0;
    let mut item_count = 0;
    let mut bytes_after = 0;
    let mut data = ptr::null_mut();
    let status = unsafe {
        xlib::XGetWindowProperty(
            display,
            xlib::XDefaultRootWindow(display),
            property,
            0,
            4096,
            0,
            xlib::AnyPropertyType as u64,
            &mut actual_type,
            &mut actual_format,
            &mut item_count,
            &mut bytes_after,
            &mut data,
        )
    };
    if status != xlib::Success as i32 || data.is_null() {
        return Ok(None);
    }
    let bytes = unsafe { std::slice::from_raw_parts(data, item_count as usize) };
    let fields = parse_rules_property(bytes);
    unsafe { xlib::XFree(data.cast::<c_void>()) };
    if actual_format != 8 || fields.len() < 5 {
        return Ok(None);
    }
    let layouts = split_rules_list(&fields[2]);
    let mut variants = split_rules_list(&fields[3]);
    variants.resize(layouts.len(), String::new());
    variants.truncate(layouts.len());
    Ok(Some((layouts, variants)))
}

fn parse_rules_property(bytes: &[u8]) -> Vec<String> {
    bytes
        .split(|byte| *byte == 0)
        .map(|field| String::from_utf8_lossy(field).into_owned())
        .collect()
}

fn split_rules_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|part| part.trim().to_owned())
        .collect()
}

fn canonical_layout_id(layout: &str, variant: Option<&str>) -> Result<String, X11InputSourceError> {
    if !valid_component(layout) || variant.is_some_and(|value| !valid_component(value)) {
        return Err(X11InputSourceError::new(
            "invalid-rules-metadata",
            format!("XKB rules contain an unsupported layout or variant: '{layout}'"),
        ));
    }
    Ok(match variant.filter(|value| !value.is_empty()) {
        Some(variant) => format!("xkb:layout:{layout}:{variant}"),
        None => format!("xkb:layout:{layout}"),
    })
}

fn valid_component(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_+.-".contains(&byte))
}

fn resolve_sources(
    configured_source_ids: &[String],
    groups: &[X11GroupDiagnostic],
) -> Result<HashMap<String, u32>, X11InputSourceError> {
    let mut result = HashMap::new();
    let mut claimed_groups = HashSet::new();
    for source_id in configured_source_ids {
        let matches: Vec<u32> = groups
            .iter()
            .filter(|group| {
                group
                    .identifiers
                    .iter()
                    .any(|identifier| identifier == source_id)
            })
            .map(|group| group.group_index)
            .collect();
        if matches.len() > 1 {
            return Err(X11InputSourceError::new(
                "ambiguous-mapping",
                format!("XKB source '{source_id}' resolves to multiple groups"),
            ));
        }
        let Some(group) = matches.first().copied() else {
            continue;
        };
        if !claimed_groups.insert(group) {
            return Err(X11InputSourceError::new(
                "ambiguous-mapping",
                format!("More than one configured XKB source resolves to group {group}"),
            ));
        }
        result.insert(source_id.clone(), group);
    }
    Ok(result)
}

fn source_id_for_group(
    group_index: u32,
    configured_source_ids: &[String],
    source_to_group: &HashMap<String, u32>,
    groups: &[X11GroupDiagnostic],
) -> Option<String> {
    if let Some(source_id) = configured_source_ids
        .iter()
        .find(|source_id| source_to_group.get(*source_id) == Some(&group_index))
    {
        return Some(source_id.clone());
    }
    groups
        .iter()
        .find(|group| group.group_index == group_index)
        .and_then(|group| group.identifiers.first().cloned())
}

fn select_group(
    session: &SessionClassification,
    target_group: u32,
    source_id: &str,
) -> Result<(), X11InputSourceError> {
    let display = open_display(session)?;
    let result = (|| {
        let mut backend = NativeXkbBackend { display };
        backend.subscribe()?;
        select_and_confirm_backend(
            &mut backend,
            target_group,
            source_id,
            XKB_SELECTION_TIMEOUT,
            XKB_WORKER_POLL,
        )
    })();
    unsafe { xlib::XCloseDisplay(display) };
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(index: u32, identifiers: &[&str]) -> X11GroupDiagnostic {
        X11GroupDiagnostic {
            group_index: index,
            group_name: format!("Group {index}"),
            layout: None,
            variant: None,
            identifiers: identifiers
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
        }
    }

    struct FakeBackend {
        calls: Vec<&'static str>,
        current_groups: Vec<Result<u32, X11InputSourceError>>,
        reject_selection: bool,
    }

    impl XkbLifecycleBackend for FakeBackend {
        fn subscribe(&mut self) -> Result<i32, X11InputSourceError> {
            self.calls.push("subscribe");
            Ok(77)
        }

        fn current_group(&mut self) -> Result<u32, X11InputSourceError> {
            self.calls.push("current");
            if self.current_groups.len() > 1 {
                self.current_groups.remove(0)
            } else {
                self.current_groups[0].clone()
            }
        }

        fn lock_group(&mut self, _group: u32) -> Result<(), X11InputSourceError> {
            self.calls.push("lock");
            if self.reject_selection {
                Err(X11InputSourceError::new("selection-rejected", "rejected"))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn classifies_x11_wayland_and_unlabelled_sessions() {
        assert_eq!(
            classify_session(Some("x11"), Some(":0"), Some("wayland-0"))
                .unwrap()
                .label,
            "x11"
        );
        assert_eq!(
            classify_session(Some("wayland"), Some(":0"), Some("wayland-0"))
                .unwrap_err()
                .reason,
            "wayland-session"
        );
        assert_eq!(
            classify_session(None, Some(":0"), Some("wayland-0"))
                .unwrap_err()
                .reason,
            "wayland-session"
        );
        assert_eq!(
            classify_session(None, None, None).unwrap_err().reason,
            "missing-display"
        );
        assert_eq!(
            classify_session(None, Some(":0"), None).unwrap().label,
            "x11-unclassified"
        );
    }

    #[test]
    fn parses_rules_property_and_preserves_empty_variants() {
        let fields = parse_rules_property(b"evdev\0pc105\0de,ru,us\0,,dvorak\0grp:caps_toggle\0");
        assert_eq!(fields[2], "de,ru,us");
        assert_eq!(split_rules_list(&fields[3]), ["", "", "dvorak"]);
        assert_eq!(
            canonical_layout_id("us", Some("dvorak")).unwrap(),
            "xkb:layout:us:dvorak"
        );
        assert_eq!(canonical_layout_id("de", None).unwrap(), "xkb:layout:de");
    }

    #[test]
    fn resolves_stable_and_fallback_ids_and_leaves_missing_unavailable() {
        let groups = vec![
            group(0, &["xkb:layout:de", "xkb:group:0"]),
            group(1, &["xkb:layout:ru", "xkb:group:1"]),
        ];
        let configured = vec![
            "xkb:layout:de".to_owned(),
            "xkb:group:1".to_owned(),
            "xkb:layout:us".to_owned(),
        ];
        let mapping = resolve_sources(&configured, &groups).unwrap();
        assert_eq!(mapping.get("xkb:layout:de"), Some(&0));
        assert_eq!(mapping.get("xkb:group:1"), Some(&1));
        assert!(!mapping.contains_key("xkb:layout:us"));
    }

    #[test]
    fn rejects_multiple_configured_ids_for_one_group() {
        let groups = vec![group(0, &["xkb:layout:de", "xkb:group:0"])];
        let configured = vec!["xkb:layout:de".to_owned(), "xkb:group:0".to_owned()];
        assert_eq!(
            resolve_sources(&configured, &groups).unwrap_err().reason,
            "ambiguous-mapping"
        );
    }

    #[test]
    fn prefers_configured_id_and_falls_back_to_detected_stable_id() {
        let groups = vec![
            group(0, &["xkb:layout:de", "xkb:group:0"]),
            group(1, &["xkb:layout:ru", "xkb:group:1"]),
        ];
        let configured = vec!["xkb:group:0".to_owned()];
        let mapping = resolve_sources(&configured, &groups).unwrap();
        assert_eq!(
            source_id_for_group(0, &configured, &mapping, &groups).as_deref(),
            Some("xkb:group:0")
        );
        assert_eq!(
            source_id_for_group(1, &configured, &mapping, &groups).as_deref(),
            Some("xkb:layout:ru")
        );
    }

    #[test]
    fn lifecycle_subscribes_before_reading_the_bootstrap_group() {
        let mut backend = FakeBackend {
            calls: Vec::new(),
            current_groups: vec![Ok(2)],
            reject_selection: false,
        };
        assert_eq!(bootstrap_backend(&mut backend).unwrap(), (77, 2));
        assert_eq!(backend.calls, ["subscribe", "current"]);
    }

    #[test]
    fn selection_requires_matching_confirmation_and_propagates_rejection() {
        let mut backend = FakeBackend {
            calls: Vec::new(),
            current_groups: vec![Ok(0), Ok(1)],
            reject_selection: false,
        };
        select_and_confirm_backend(
            &mut backend,
            1,
            "xkb:layout:ru",
            Duration::from_millis(20),
            Duration::ZERO,
        )
        .unwrap();
        assert_eq!(backend.calls, ["lock", "current", "current"]);

        let mut rejected = FakeBackend {
            calls: Vec::new(),
            current_groups: vec![Ok(0)],
            reject_selection: true,
        };
        assert_eq!(
            select_and_confirm_backend(
                &mut rejected,
                1,
                "xkb:layout:ru",
                Duration::ZERO,
                Duration::ZERO,
            )
            .unwrap_err()
            .reason,
            "selection-rejected"
        );
        assert_eq!(rejected.calls, ["lock"]);
    }

    #[test]
    fn selection_times_out_when_confirmation_stays_mismatched() {
        let mut backend = FakeBackend {
            calls: Vec::new(),
            current_groups: vec![Ok(0)],
            reject_selection: false,
        };
        let error = select_and_confirm_backend(
            &mut backend,
            1,
            "xkb:layout:ru",
            Duration::ZERO,
            Duration::ZERO,
        )
        .unwrap_err();
        assert_eq!(error.reason, "selection-timeout");
        assert_eq!(backend.calls, ["lock", "current"]);
    }

    #[test]
    fn stale_worker_generation_is_invalidated() {
        let generation = AtomicU64::new(4);
        assert!(generation_is_current(&generation, 4));
        generation.fetch_add(1, Ordering::SeqCst);
        assert!(!generation_is_current(&generation, 4));
    }

    #[test]
    fn worker_registration_stop_sets_flag_and_joins() {
        let stop = Arc::new(AtomicBool::new(false));
        let wake = Arc::new((Mutex::new(false), Condvar::new()));
        let observed = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let worker_observed = observed.clone();
        let handle = thread::spawn(move || {
            while !worker_stop.load(Ordering::SeqCst) {
                thread::yield_now();
            }
            worker_observed.store(true, Ordering::SeqCst);
        });
        WorkerRegistration {
            stop,
            wake,
            handle: Some(handle),
        }
        .stop();
        assert!(observed.load(Ordering::SeqCst));
    }
}
