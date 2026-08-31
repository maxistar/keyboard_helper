use anyhow::{anyhow, Context, Result};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{declare_class, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_core_bluetooth::{
    CBCentralManager, CBCentralManagerDelegate, CBCharacteristic, CBCharacteristicProperties,
    CBCharacteristicWriteType, CBManagerState, CBPeripheral, CBPeripheralDelegate,
    CBPeripheralState, CBService, CBUUID,
};
use objc2_foundation::{NSArray, NSData, NSError, NSObject, NSObjectProtocol, NSString};
use std::collections::VecDeque;
use std::ffi::CString;
use std::os::raw::{c_char, c_void};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(3);
const NOTIFY_STATE_TIMEOUT: Duration = Duration::from_secs(3);
const WRITE_TIMEOUT: Duration = Duration::from_secs(3);
const CAPABILITIES_UUID: &str = "b34a0003-e782-4706-8f9c-6c056c416507";
const EVENT_UUID: &str = "b34a0004-e782-4706-8f9c-6c056c416507";
const BATTERY_SERVICE_UUID: &str = "0000180f-0000-1000-8000-00805f9b34fb";
const BATTERY_LEVEL_UUID: &str = "00002a19-0000-1000-8000-00805f9b34fb";
const DEVICE_INFORMATION_SERVICE_UUID: &str = "0000180a-0000-1000-8000-00805f9b34fb";

pub enum Notification {
    Layer(u32),
    KeyboardEvent(Vec<u8>),
    Battery(Vec<u8>),
}

pub struct ConnectedKeyboard {
    _delegate: Retained<CoreBluetoothDelegate>,
    _manager: Retained<CBCentralManager>,
    peripheral: Retained<CBPeripheral>,
    layer_char: Retained<CBCharacteristic>,
    capabilities_char: Option<Retained<CBCharacteristic>>,
    event_char: Option<Retained<CBCharacteristic>>,
    battery_char: Option<Retained<CBCharacteristic>>,
    device_information_available: bool,
    events: Receiver<DelegateEvent>,
    deferred_events: Mutex<VecDeque<DelegateEvent>>,
    peripheral_id: Uuid,
    layer_char_uuid: Uuid,
    capabilities_char_uuid: Uuid,
    event_char_uuid: Uuid,
    battery_char_uuid: Uuid,
}

impl ConnectedKeyboard {
    pub fn supports_write_with_response(&self) -> bool {
        unsafe { self.layer_char.properties() }
            .contains(CBCharacteristicProperties::CBCharacteristicPropertyWrite)
    }

    pub fn write_active_layer(&self, layer: u32) -> Result<()> {
        if !self.supports_write_with_response() {
            return Err(anyhow!(
                "Layer characteristic does not support Write with response"
            ));
        }
        let bytes = layer.to_le_bytes();
        let data =
            unsafe { NSData::dataWithBytes_length(bytes.as_ptr().cast_mut().cast(), bytes.len()) };
        unsafe {
            self.peripheral.writeValue_forCharacteristic_type(
                &data,
                &self.layer_char,
                CBCharacteristicWriteType::CBCharacteristicWriteWithResponse,
            );
        }
        wait_for_event_preserving(
            &self.events,
            &self.deferred_events,
            WRITE_TIMEOUT,
            |event| match event {
                DelegateEvent::CharacteristicWritten(
                    peripheral_id,
                    characteristic_uuid,
                    result,
                ) if *peripheral_id == self.peripheral_id
                    && *characteristic_uuid == self.layer_char_uuid =>
                {
                    Some(result.clone())
                }
                _ => None,
            },
        )?
        .map_err(|error| anyhow!(error))
    }

    pub fn read_active_layer(&self) -> Result<u32> {
        decode_active_layer(&self.read_characteristic(&self.layer_char, self.layer_char_uuid)?)
    }

    pub fn has_capabilities_characteristic(&self) -> bool {
        self.capabilities_char.is_some()
    }

    pub fn supports_event_notifications(&self) -> bool {
        self.event_char.as_ref().is_some_and(|characteristic| {
            unsafe { characteristic.properties() }
                .contains(CBCharacteristicProperties::CBCharacteristicPropertyNotify)
        })
    }

    pub fn has_battery_characteristic(&self) -> bool {
        self.battery_char.is_some()
    }

    pub fn has_device_information_service(&self) -> bool {
        self.device_information_available
    }

    pub fn read_capabilities(&self) -> Result<Option<Vec<u8>>> {
        self.capabilities_char
            .as_ref()
            .map(|characteristic| {
                self.read_characteristic(characteristic, self.capabilities_char_uuid)
            })
            .transpose()
    }

    pub fn read_battery(&self) -> Result<Option<Vec<u8>>> {
        self.battery_char
            .as_ref()
            .filter(|characteristic| {
                unsafe { characteristic.properties() }
                    .contains(CBCharacteristicProperties::CBCharacteristicPropertyRead)
            })
            .map(|characteristic| self.read_characteristic(characteristic, self.battery_char_uuid))
            .transpose()
    }

    fn read_characteristic(
        &self,
        characteristic: &CBCharacteristic,
        characteristic_uuid: Uuid,
    ) -> Result<Vec<u8>> {
        unsafe {
            self.peripheral.readValueForCharacteristic(characteristic);
        }

        wait_for_event_preserving(&self.events, &self.deferred_events, READ_TIMEOUT, |event| {
            match event {
                DelegateEvent::CharacteristicValue(peripheral_id, observed_uuid, result)
                    if *peripheral_id == self.peripheral_id
                        && *observed_uuid == characteristic_uuid =>
                {
                    Some(result.clone())
                }
                _ => None,
            }
        })?
        .map_err(|error| anyhow!(error))
    }

    pub fn start_notifications(&self, enable_events: bool) -> Result<()> {
        self.start_notification(&self.layer_char, self.layer_char_uuid, true)?;
        if enable_events {
            if let Some(characteristic) = &self.event_char {
                self.start_notification(characteristic, self.event_char_uuid, true)?;
            }
        }
        if let Some(characteristic) = &self.battery_char {
            self.start_notification(characteristic, self.battery_char_uuid, false)?;
        }
        Ok(())
    }

    fn start_notification(
        &self,
        characteristic: &CBCharacteristic,
        characteristic_uuid: Uuid,
        required: bool,
    ) -> Result<()> {
        let properties = unsafe { characteristic.properties() };
        if !properties.contains(CBCharacteristicProperties::CBCharacteristicPropertyNotify) {
            return if required {
                Err(anyhow!(
                    "Characteristic {characteristic_uuid} does not support notifications"
                ))
            } else {
                Ok(())
            };
        }

        if unsafe { characteristic.isNotifying() } {
            return Ok(());
        }

        unsafe {
            self.peripheral
                .setNotifyValue_forCharacteristic(true, characteristic);
        }

        wait_for_event_preserving(
            &self.events,
            &self.deferred_events,
            NOTIFY_STATE_TIMEOUT,
            |event| match event {
                DelegateEvent::NotificationState(peripheral_id, observed_uuid, result)
                    if *peripheral_id == self.peripheral_id
                        && *observed_uuid == characteristic_uuid =>
                {
                    Some(result.clone())
                }
                _ => None,
            },
        )?
        .map_err(|error| anyhow!(error))?;

        Ok(())
    }

    pub fn wait_for_notification_timeout(&self, timeout: Duration) -> Result<Option<Notification>> {
        let deferred = self
            .deferred_events
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .pop_front();
        let event = match deferred
            .map(Ok)
            .unwrap_or_else(|| self.events.recv_timeout(timeout))
        {
            Ok(event) => event,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return Ok(None),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(anyhow!("Bluetooth event channel closed"))
            }
        };

        match event {
            DelegateEvent::CharacteristicValue(peripheral_id, characteristic_uuid, result)
                if peripheral_id == self.peripheral_id
                    && characteristic_uuid == self.layer_char_uuid =>
            {
                let data = result.map_err(|error| anyhow!(error))?;
                Ok(Some(Notification::Layer(decode_active_layer(&data)?)))
            }
            DelegateEvent::CharacteristicValue(peripheral_id, characteristic_uuid, result)
                if peripheral_id == self.peripheral_id
                    && characteristic_uuid == self.event_char_uuid =>
            {
                Ok(Some(Notification::KeyboardEvent(
                    result.map_err(|error| anyhow!(error))?,
                )))
            }
            DelegateEvent::CharacteristicValue(peripheral_id, characteristic_uuid, result)
                if peripheral_id == self.peripheral_id
                    && characteristic_uuid == self.battery_char_uuid =>
            {
                Ok(Some(Notification::Battery(
                    result.map_err(|error| anyhow!(error))?,
                )))
            }
            _ => Ok(None),
        }
    }
}

pub fn find_connected_keyboard(
    service_uuid: Uuid,
    char_uuid: Uuid,
    name_filter: Option<&str>,
) -> Result<Option<ConnectedKeyboard>> {
    let capabilities_char_uuid = Uuid::parse_str(CAPABILITIES_UUID)?;
    let event_char_uuid = Uuid::parse_str(EVENT_UUID)?;
    let battery_service_uuid = Uuid::parse_str(BATTERY_SERVICE_UUID)?;
    let battery_char_uuid = Uuid::parse_str(BATTERY_LEVEL_UUID)?;
    let device_information_service_uuid = Uuid::parse_str(DEVICE_INFORMATION_SERVICE_UUID)?;
    let (sender, receiver) = mpsc::channel();
    let delegate = CoreBluetoothDelegate::new(sender);

    let label = CString::new("keyboard-helper-ble-cb").unwrap();
    let queue = unsafe { dispatch_queue_create(label.as_ptr(), DISPATCH_QUEUE_SERIAL) };
    let queue: *mut AnyObject = queue.cast();
    let manager: Retained<CBCentralManager> = unsafe {
        msg_send_id![CBCentralManager::alloc(), initWithDelegate: &*delegate, queue: queue]
    };

    let state = wait_for_event(&receiver, CONNECT_TIMEOUT, |event| match event {
        DelegateEvent::ManagerState(state) => Some(*state),
        _ => None,
    })?;
    if state != CBManagerState::PoweredOn {
        return Err(anyhow!("Bluetooth adapter is not powered on"));
    }

    let service_uuid_obj = uuid_to_cbuuid(service_uuid);
    let services = NSArray::from_id_slice(&[service_uuid_obj.clone()]);
    let peripherals = unsafe { manager.retrieveConnectedPeripheralsWithServices(&services) };

    for peripheral in peripherals {
        let peripheral_name = unsafe { peripheral.name() }.map(|name| name.to_string());
        if let Some(expected_name) = name_filter {
            if peripheral_name.as_deref() != Some(expected_name) {
                continue;
            }
        }

        let peripheral = peripheral.retain();
        unsafe {
            peripheral.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        }

        let peripheral_id = nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref())?;

        if unsafe { peripheral.state() } != CBPeripheralState::Connected {
            unsafe {
                manager.connectPeripheral_options(&peripheral, None);
            }

            wait_for_event(&receiver, CONNECT_TIMEOUT, |event| match event {
                DelegateEvent::Connected(id) if *id == peripheral_id => Some(Ok(())),
                DelegateEvent::ConnectionFailed(id, error) if *id == peripheral_id => {
                    Some(Err(anyhow!(error.clone())))
                }
                _ => None,
            })??;
        }

        let requested_service = uuid_to_cbuuid(service_uuid);
        let requested_battery_service = uuid_to_cbuuid(battery_service_uuid);
        let requested_device_information_service = uuid_to_cbuuid(device_information_service_uuid);
        let service_array = NSArray::from_id_slice(&[
            requested_service.clone(),
            requested_battery_service.clone(),
            requested_device_information_service.clone(),
        ]);
        unsafe {
            peripheral.discoverServices(Some(&service_array));
        }

        wait_for_event(&receiver, DISCOVERY_TIMEOUT, |event| match event {
            DelegateEvent::ServicesDiscovered(id, result) if *id == peripheral_id => {
                Some(result.clone())
            }
            _ => None,
        })?
        .map_err(|error| anyhow!(error))?;

        let service = find_service(&peripheral, service_uuid)
            .with_context(|| format!("Service {service_uuid} not found on connected keyboard"))?;

        unsafe {
            peripheral.discoverCharacteristics_forService(None, &service);
        }

        wait_for_event(&receiver, DISCOVERY_TIMEOUT, |event| match event {
            DelegateEvent::CharacteristicsDiscovered(id, discovered_service_uuid, result)
                if *id == peripheral_id && *discovered_service_uuid == service_uuid =>
            {
                Some(result.clone())
            }
            _ => None,
        })?
        .map_err(|error| anyhow!(error))?;

        let layer_char = find_characteristic(&service, char_uuid).with_context(|| {
            format!("Characteristic {char_uuid} not found on connected keyboard")
        })?;
        let capabilities_char = find_optional_characteristic(&service, capabilities_char_uuid)?;
        let event_char = find_optional_characteristic(&service, event_char_uuid)?;

        let battery_char = if let Some(battery_service) =
            find_optional_service(&peripheral, battery_service_uuid)?
        {
            let requested_battery_char = uuid_to_cbuuid(battery_char_uuid);
            let battery_chars = NSArray::from_id_slice(&[requested_battery_char.clone()]);
            unsafe {
                peripheral
                    .discoverCharacteristics_forService(Some(&battery_chars), &battery_service);
            }
            wait_for_event(&receiver, DISCOVERY_TIMEOUT, |event| match event {
                DelegateEvent::CharacteristicsDiscovered(id, discovered_service_uuid, result)
                    if *id == peripheral_id && *discovered_service_uuid == battery_service_uuid =>
                {
                    Some(result.clone())
                }
                _ => None,
            })?
            .map_err(|error| anyhow!(error))?;
            find_optional_characteristic(&battery_service, battery_char_uuid)?
        } else {
            None
        };

        let device_information_available =
            find_optional_service(&peripheral, device_information_service_uuid)?.is_some();

        let properties = unsafe { layer_char.properties() };
        if !properties.contains(CBCharacteristicProperties::CBCharacteristicPropertyRead) {
            return Err(anyhow!("Layer characteristic is not readable"));
        }

        return Ok(Some(ConnectedKeyboard {
            _delegate: delegate,
            _manager: manager,
            peripheral,
            layer_char,
            capabilities_char,
            event_char,
            battery_char,
            device_information_available,
            events: receiver,
            deferred_events: Mutex::new(VecDeque::new()),
            peripheral_id,
            layer_char_uuid: char_uuid,
            capabilities_char_uuid,
            event_char_uuid,
            battery_char_uuid,
        }));
    }

    Ok(None)
}

fn decode_active_layer(data: &[u8]) -> Result<u32> {
    let bytes: [u8; 4] = data
        .try_into()
        .map_err(|_| anyhow!("Expected 4 bytes, got {}", data.len()))?;
    Ok(u32::from_le_bytes(bytes))
}

#[derive(Clone, Debug)]
enum DelegateEvent {
    ManagerState(CBManagerState),
    Connected(Uuid),
    ConnectionFailed(Uuid, String),
    ServicesDiscovered(Uuid, Result<(), String>),
    CharacteristicsDiscovered(Uuid, Uuid, Result<(), String>),
    NotificationState(Uuid, Uuid, Result<(), String>),
    CharacteristicWritten(Uuid, Uuid, Result<(), String>),
    CharacteristicValue(Uuid, Uuid, Result<Vec<u8>, String>),
}

declare_class!(
    #[derive(Debug)]
    struct CoreBluetoothDelegate;

    unsafe impl ClassType for CoreBluetoothDelegate {
        type Super = NSObject;
        type Mutability = mutability::InteriorMutable;
        const NAME: &'static str = "KeyboardHelperCoreBluetoothDelegate";
    }

    impl DeclaredClass for CoreBluetoothDelegate {
        type Ivars = Sender<DelegateEvent>;
    }

    unsafe impl NSObjectProtocol for CoreBluetoothDelegate {}

    unsafe impl CBCentralManagerDelegate for CoreBluetoothDelegate {
        #[method(centralManagerDidUpdateState:)]
        fn central_manager_did_update_state(&self, central: &CBCentralManager) {
            self.send(DelegateEvent::ManagerState(unsafe { central.state() }));
        }

        #[method(centralManager:didConnectPeripheral:)]
        fn central_manager_did_connect_peripheral(
            &self,
            _central: &CBCentralManager,
            peripheral: &CBPeripheral,
        ) {
            if let Ok(id) = nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref()) {
                self.send(DelegateEvent::Connected(id));
            }
        }

        #[method(centralManager:didFailToConnectPeripheral:error:)]
        fn central_manager_did_fail_to_connect_peripheral_error(
            &self,
            _central: &CBCentralManager,
            peripheral: &CBPeripheral,
            error: Option<&NSError>,
        ) {
            if let Ok(id) = nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref()) {
                self.send(DelegateEvent::ConnectionFailed(
                    id,
                    localized_description(error),
                ));
            }
        }
    }

    unsafe impl CBPeripheralDelegate for CoreBluetoothDelegate {
        #[method(peripheral:didDiscoverServices:)]
        fn peripheral_did_discover_services(
            &self,
            peripheral: &CBPeripheral,
            error: Option<&NSError>,
        ) {
            if let Ok(id) = nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref()) {
                self.send(DelegateEvent::ServicesDiscovered(
                    id,
                    match error {
                        Some(error) => Err(error.localizedDescription().to_string()),
                        None => Ok(()),
                    },
                ));
            }
        }

        #[method(peripheral:didDiscoverCharacteristicsForService:error:)]
        fn peripheral_did_discover_characteristics_for_service_error(
            &self,
            peripheral: &CBPeripheral,
            service: &CBService,
            error: Option<&NSError>,
        ) {
            if let (Ok(id), Ok(service_uuid)) = (
                nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref()),
                cbuuid_to_uuid(unsafe { service.UUID() }.as_ref()),
            ) {
                self.send(DelegateEvent::CharacteristicsDiscovered(
                    id,
                    service_uuid,
                    match error {
                        Some(error) => Err(error.localizedDescription().to_string()),
                        None => Ok(()),
                    },
                ));
            }
        }

        #[method(peripheral:didUpdateValueForCharacteristic:error:)]
        fn peripheral_did_update_value_for_characteristic_error(
            &self,
            peripheral: &CBPeripheral,
            characteristic: &CBCharacteristic,
            error: Option<&NSError>,
        ) {
            if let (Ok(id), Ok(characteristic_uuid)) = (
                nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref()),
                cbuuid_to_uuid(unsafe { characteristic.UUID() }.as_ref()),
            ) {
                let result = match error {
                    Some(error) => Err(error.localizedDescription().to_string()),
                    None => Ok(get_characteristic_value(characteristic)),
                };
                self.send(DelegateEvent::CharacteristicValue(id, characteristic_uuid, result));
            }
        }

        #[method(peripheral:didUpdateNotificationStateForCharacteristic:error:)]
        fn peripheral_did_update_notification_state_for_characteristic_error(
            &self,
            peripheral: &CBPeripheral,
            characteristic: &CBCharacteristic,
            error: Option<&NSError>,
        ) {
            if let (Ok(id), Ok(characteristic_uuid)) = (
                nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref()),
                cbuuid_to_uuid(unsafe { characteristic.UUID() }.as_ref()),
            ) {
                self.send(DelegateEvent::NotificationState(
                    id,
                    characteristic_uuid,
                    match error {
                        Some(error) => Err(error.localizedDescription().to_string()),
                        None => Ok(()),
                    },
                ));
            }
        }

        #[method(peripheral:didWriteValueForCharacteristic:error:)]
        fn peripheral_did_write_value_for_characteristic_error(
            &self,
            peripheral: &CBPeripheral,
            characteristic: &CBCharacteristic,
            error: Option<&NSError>,
        ) {
            if let (Ok(id), Ok(characteristic_uuid)) = (
                nsuuid_to_uuid(unsafe { peripheral.identifier() }.as_ref()),
                cbuuid_to_uuid(unsafe { characteristic.UUID() }.as_ref()),
            ) {
                self.send(DelegateEvent::CharacteristicWritten(
                    id,
                    characteristic_uuid,
                    match error {
                        Some(error) => Err(error.localizedDescription().to_string()),
                        None => Ok(()),
                    },
                ));
            }
        }
    }
);

impl CoreBluetoothDelegate {
    fn new(sender: Sender<DelegateEvent>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(sender);
        unsafe { msg_send_id![super(this), init] }
    }

    fn send(&self, event: DelegateEvent) {
        let _ = self.ivars().send(event);
    }
}

fn wait_for_event<T, F>(
    receiver: &Receiver<DelegateEvent>,
    timeout: Duration,
    mut matcher: F,
) -> Result<T>
where
    F: FnMut(&DelegateEvent) -> Option<T>,
{
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| anyhow!("Timed out waiting for Bluetooth response"))?;
        let event = receiver
            .recv_timeout(remaining)
            .map_err(|_| anyhow!("Timed out waiting for Bluetooth response"))?;
        if let Some(result) = matcher(&event) {
            return Ok(result);
        }
    }
}

fn wait_for_event_preserving<T, F>(
    receiver: &Receiver<DelegateEvent>,
    deferred: &Mutex<VecDeque<DelegateEvent>>,
    timeout: Duration,
    mut matcher: F,
) -> Result<T>
where
    F: FnMut(&DelegateEvent) -> Option<T>,
{
    let deadline = Instant::now() + timeout;
    loop {
        {
            let mut backlog = deferred
                .lock()
                .map_err(|error| anyhow!(error.to_string()))?;
            if let Some(index) = backlog.iter().position(|event| matcher(event).is_some()) {
                let event = backlog.remove(index).expect("deferred event index exists");
                return matcher(&event).ok_or_else(|| anyhow!("Bluetooth event no longer matched"));
            }
        }
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| anyhow!("Timed out waiting for Bluetooth response"))?;
        let event = receiver
            .recv_timeout(remaining)
            .map_err(|_| anyhow!("Timed out waiting for Bluetooth response"))?;
        if let Some(result) = matcher(&event) {
            return Ok(result);
        }
        deferred
            .lock()
            .map_err(|error| anyhow!(error.to_string()))?
            .push_back(event);
    }
}

fn find_service(peripheral: &CBPeripheral, expected: Uuid) -> Result<Retained<CBService>> {
    let services =
        unsafe { peripheral.services() }.ok_or_else(|| anyhow!("No services discovered"))?;
    for service in services {
        if cbuuid_to_uuid(unsafe { service.UUID() }.as_ref())? == expected {
            return Ok(service);
        }
    }
    Err(anyhow!("Service not found"))
}

fn find_optional_service(
    peripheral: &CBPeripheral,
    expected: Uuid,
) -> Result<Option<Retained<CBService>>> {
    let services =
        unsafe { peripheral.services() }.ok_or_else(|| anyhow!("No services discovered"))?;
    for service in services {
        if cbuuid_to_uuid(unsafe { service.UUID() }.as_ref())? == expected {
            return Ok(Some(service));
        }
    }
    Ok(None)
}

fn find_characteristic(service: &CBService, expected: Uuid) -> Result<Retained<CBCharacteristic>> {
    let chars = unsafe { service.characteristics() }
        .ok_or_else(|| anyhow!("No characteristics discovered"))?;
    for characteristic in chars {
        if cbuuid_to_uuid(unsafe { characteristic.UUID() }.as_ref())? == expected {
            return Ok(characteristic);
        }
    }
    Err(anyhow!("Characteristic not found"))
}

fn find_optional_characteristic(
    service: &CBService,
    expected: Uuid,
) -> Result<Option<Retained<CBCharacteristic>>> {
    let chars = unsafe { service.characteristics() }
        .ok_or_else(|| anyhow!("No characteristics discovered"))?;
    for characteristic in chars {
        if cbuuid_to_uuid(unsafe { characteristic.UUID() }.as_ref())? == expected {
            return Ok(Some(characteristic));
        }
    }
    Ok(None)
}

fn get_characteristic_value(characteristic: &CBCharacteristic) -> Vec<u8> {
    unsafe { characteristic.value() }
        .map(|value: Retained<NSData>| value.bytes().into())
        .unwrap_or_default()
}

fn nsuuid_to_uuid(uuid: &objc2_foundation::NSUUID) -> Result<Uuid> {
    Uuid::parse_str(&uuid.UUIDString().to_string()).context("invalid peripheral UUID")
}

fn cbuuid_to_uuid(uuid: &CBUUID) -> Result<Uuid> {
    Uuid::parse_str(&unsafe { uuid.UUIDString() }.to_string())
        .context("invalid service/characteristic UUID")
}

fn uuid_to_cbuuid(uuid: Uuid) -> Retained<CBUUID> {
    let string = NSString::from_str(&uuid.to_string());
    unsafe { CBUUID::UUIDWithString(&string) }
}

fn localized_description(error: Option<&NSError>) -> String {
    error
        .map(|error| error.localizedDescription().to_string())
        .unwrap_or_default()
}

#[allow(non_camel_case_types)]
type dispatch_object_s = c_void;
#[allow(non_camel_case_types)]
type dispatch_queue_t = *mut dispatch_object_s;
#[allow(non_camel_case_types)]
type dispatch_queue_attr_t = *const dispatch_object_s;

const DISPATCH_QUEUE_SERIAL: dispatch_queue_attr_t = 0 as dispatch_queue_attr_t;

unsafe extern "C" {
    fn dispatch_queue_create(label: *const c_char, attr: dispatch_queue_attr_t)
        -> dispatch_queue_t;
}

#[cfg_attr(target_os = "macos", link(name = "AppKit", kind = "framework"))]
unsafe extern "C" {}
