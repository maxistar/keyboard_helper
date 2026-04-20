use anyhow::{anyhow, Context, Result};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{declare_class, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_core_bluetooth::{
    CBCentralManager, CBCentralManagerDelegate, CBCharacteristic, CBCharacteristicProperties,
    CBManagerState, CBPeripheral, CBPeripheralDelegate, CBPeripheralState, CBService, CBUUID,
};
use objc2_foundation::{NSArray, NSData, NSError, NSObject, NSObjectProtocol, NSString};
use std::ffi::CString;
use std::os::raw::{c_char, c_void};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};
use uuid::Uuid;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(3);
const NOTIFY_STATE_TIMEOUT: Duration = Duration::from_secs(3);

pub struct ConnectedKeyboard {
    _delegate: Retained<CoreBluetoothDelegate>,
    _manager: Retained<CBCentralManager>,
    peripheral: Retained<CBPeripheral>,
    layer_char: Retained<CBCharacteristic>,
    events: Receiver<DelegateEvent>,
    peripheral_id: Uuid,
    layer_char_uuid: Uuid,
}

impl ConnectedKeyboard {
    pub fn read_active_layer(&self) -> Result<u32> {
        unsafe {
            self.peripheral.readValueForCharacteristic(&self.layer_char);
        }

        let data: Vec<u8> = wait_for_event(&self.events, READ_TIMEOUT, |event| match event {
            DelegateEvent::CharacteristicValue(peripheral_id, characteristic_uuid, result)
                if *peripheral_id == self.peripheral_id
                    && *characteristic_uuid == self.layer_char_uuid =>
            {
                Some(result.clone())
            }
            _ => None,
        })?
        .map_err(|error| anyhow!(error))?;

        decode_active_layer(&data)
    }

    pub fn start_notifications(&self) -> Result<()> {
        let properties = unsafe { self.layer_char.properties() };
        if !properties.contains(CBCharacteristicProperties::CBCharacteristicPropertyNotify) {
            return Err(anyhow!("Layer characteristic does not support notifications"));
        }

        if unsafe { self.layer_char.isNotifying() } {
            return Ok(());
        }

        unsafe {
            self.peripheral
                .setNotifyValue_forCharacteristic(true, &self.layer_char);
        }

        wait_for_event(&self.events, NOTIFY_STATE_TIMEOUT, |event| match event {
            DelegateEvent::NotificationState(peripheral_id, characteristic_uuid, result)
                if *peripheral_id == self.peripheral_id
                    && *characteristic_uuid == self.layer_char_uuid =>
            {
                Some(result.clone())
            }
            _ => None,
        })?
        .map_err(|error| anyhow!(error))?;

        Ok(())
    }

    pub fn wait_for_notification_layer_timeout(&self, timeout: Duration) -> Result<Option<u32>> {
        let event = match self.events.recv_timeout(timeout) {
            Ok(event) => event,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return Ok(None),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(anyhow!("Bluetooth event channel closed"))
            }
        };

        match event {
            DelegateEvent::CharacteristicValue(peripheral_id, characteristic_uuid, result)
                if peripheral_id == self.peripheral_id && characteristic_uuid == self.layer_char_uuid =>
            {
                let data = result.map_err(|error| anyhow!(error))?;
                Ok(Some(decode_active_layer(&data)?))
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
        let service_array = NSArray::from_id_slice(&[requested_service.clone()]);
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

        let requested_char = uuid_to_cbuuid(char_uuid);
        let char_array = NSArray::from_id_slice(&[requested_char.clone()]);
        unsafe {
            peripheral.discoverCharacteristics_forService(Some(&char_array), &service);
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

        let layer_char = find_characteristic(&service, char_uuid)
            .with_context(|| format!("Characteristic {char_uuid} not found on connected keyboard"))?;

        let properties = unsafe { layer_char.properties() };
        if !properties.contains(CBCharacteristicProperties::CBCharacteristicPropertyRead) {
            return Err(anyhow!("Layer characteristic is not readable"));
        }

        return Ok(Some(ConnectedKeyboard {
            _delegate: delegate,
            _manager: manager,
            peripheral,
            layer_char,
            events: receiver,
            peripheral_id,
            layer_char_uuid: char_uuid,
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

fn find_service(peripheral: &CBPeripheral, expected: Uuid) -> Result<Retained<CBService>> {
    let services = unsafe { peripheral.services() }.ok_or_else(|| anyhow!("No services discovered"))?;
    for service in services {
        if cbuuid_to_uuid(unsafe { service.UUID() }.as_ref())? == expected {
            return Ok(service);
        }
    }
    Err(anyhow!("Service not found"))
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
