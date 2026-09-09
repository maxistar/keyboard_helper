package me.maxistar.keyboardhelper.ble

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.UUID

private const val NEARBY_ALIAS = "nearby"
private const val LOCATION_ALIAS = "location"
private val CLIENT_CONFIGURATION_UUID: UUID =
    UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

@InvokeArg
class StartScanArgs {
    var timeoutMs: Long = 10_000
    var onEvent: Channel? = null
}

@InvokeArg
class ConnectArgs {
    var address: String = ""
    var attempt: Long = 0
    var onDisconnect: Channel? = null
}

@InvokeArg
class AttemptArgs {
    var attempt: Long = 0
}

@InvokeArg
open class GattArgs {
    var attempt: Long = 0
    var serviceUuid: String = ""
    var characteristicUuid: String = ""
}

@InvokeArg
class SubscribeArgs : GattArgs() {
    var onNotification: Channel? = null
}

@InvokeArg
class AvailabilityArgs {
    var onEvent: Channel? = null
}

private enum class DescriptorOperation {
    SUBSCRIBE_RESET,
    SUBSCRIBE_ENABLE,
    UNSUBSCRIBE,
}

@TauriPlugin(
    permissions = [
        Permission(
            strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT],
            alias = NEARBY_ALIAS,
        ),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = LOCATION_ALIAS),
    ],
)
class KeyboardHelperBlePlugin(private val activity: Activity) : Plugin(activity) {
    private val handler = Handler(Looper.getMainLooper())
    private val manager = activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager.adapter
    private val scanner: BluetoothLeScanner? get() = adapter?.bluetoothLeScanner
    private val discovered = mutableMapOf<String, BluetoothDevice>()

    private var scanCallback: ScanCallback? = null
    private var scanChannel: Channel? = null
    private var scanStop: Runnable? = null
    private var gatt: BluetoothGatt? = null
    private var activeAttempt: Long = 0
    private var disconnectChannel: Channel? = null
    private var notificationChannel: Channel? = null
    private var subscribedCharacteristic: BluetoothGattCharacteristic? = null
    private var pendingConnect: Invoke? = null
    private var pendingDiscovery: Invoke? = null
    private var pendingRead: Invoke? = null
    private var pendingSubscription: Invoke? = null
    private var pendingDescriptorOperation: DescriptorOperation? = null
    private var availabilityChannel: Channel? = null
    private var availabilityReceiver: BroadcastReceiver? = null
    private var lastAvailabilityFingerprint: String? = null

    @SuppressLint("MissingPermission")
    @Command
    fun bluetoothAvailability(invoke: Invoke) {
        invoke.resolve(availabilityResponse())
    }

    @Command
    fun observeBluetoothAvailability(invoke: Invoke) {
        val args = invoke.parseArgs(AvailabilityArgs::class.java)
        availabilityChannel = args.onEvent
            ?: return invoke.reject("invalid-request: availability channel is required")
        ensureAvailabilityReceiver()
        emitAvailability(force = true)
        invoke.resolve()
    }

    @Command
    fun stopObservingBluetoothAvailability(invoke: Invoke) {
        stopAvailabilityReceiver()
        invoke.resolve()
    }

    private fun ensureAvailabilityReceiver() {
        if (availabilityReceiver != null) return
        availabilityReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == BluetoothAdapter.ACTION_STATE_CHANGED) emitAvailability()
            }
        }.also { receiver ->
            ContextCompat.registerReceiver(
                activity,
                receiver,
                IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
                ContextCompat.RECEIVER_EXPORTED,
            )
        }
    }

    @SuppressLint("MissingPermission")
    private fun availabilityResponse(): JSObject {
        val currentAdapter = adapter
        return JSObject().apply {
            val state = when {
                currentAdapter == null -> "unavailable"
                !permissionsGranted() -> "unknown"
                currentAdapter.isEnabled -> "available"
                else -> "unavailable"
            }
            put("state", state)
            put("supported", currentAdapter != null)
        }
    }

    private fun emitAvailability(force: Boolean = false) {
        val response = availabilityResponse()
        val fingerprint = "${response.getString("state")}:${response.getBoolean("supported")}"
        if (!force && fingerprint == lastAvailabilityFingerprint) return
        lastAvailabilityFingerprint = fingerprint
        availabilityChannel?.send(response)
    }

    private fun stopAvailabilityReceiver() {
        availabilityReceiver?.let { receiver -> runCatching { activity.unregisterReceiver(receiver) } }
        availabilityReceiver = null
        availabilityChannel = null
        lastAvailabilityFingerprint = null
    }

    @Command
    fun permissionStatus(invoke: Invoke) {
        invoke.resolve(permissionResponse())
    }

    @Command
    fun requestBlePermissions(invoke: Invoke) {
        val alias = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) NEARBY_ALIAS else LOCATION_ALIAS
        val preferences = activity.getSharedPreferences("keyboard-helper-ble-permissions", Activity.MODE_PRIVATE)
        preferences.edit().also { editor -> requiredRuntimePermissions().forEach { editor.putBoolean(it, true) } }.apply()
        requestPermissionForAlias(alias, invoke, "permissionResult")
    }

    @PermissionCallback
    fun permissionResult(invoke: Invoke) {
        invoke.resolve(permissionResponse())
    }

    private fun permissionResponse(): JSObject {
        val permissions = requiredRuntimePermissions()
        val granted = permissions.all {
            ActivityCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
        }
        val preferences = activity.getSharedPreferences("keyboard-helper-ble-permissions", Activity.MODE_PRIVATE)
        val requested = permissions.any { preferences.getBoolean(it, false) }
        val rationale = permissions.any { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
        val state = when {
            granted -> "granted"
            !requested -> "prompt"
            rationale -> "denied"
            else -> "permanently-denied"
        }
        return JSObject().apply {
            put("state", state)
            put("sdkInt", Build.VERSION.SDK_INT)
        }
    }

    private fun requiredRuntimePermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    @SuppressLint("MissingPermission")
    @Command
    fun startScan(invoke: Invoke) {
        val args = invoke.parseArgs(StartScanArgs::class.java)
        if (!permissionsGranted()) return invoke.reject("permission-required: Bluetooth permission is required")
        if (scanCallback != null) return invoke.reject("invalid-state: scan already running")
        if (gatt != null) return invoke.reject("invalid-state: disconnect before scanning")
        val bleScanner = scanner ?: return invoke.reject("adapter-unavailable: Bluetooth is disabled or unavailable")
        val channel = args.onEvent ?: return invoke.reject("invalid-request: scan channel is required")
        if (args.timeoutMs <= 0) return invoke.reject("invalid-timeout: scan timeout must be positive")

        discovered.clear()
        scanChannel = channel
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) = emitDevice(result)
            override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach(::emitDevice)
            override fun onScanFailed(errorCode: Int) {
                channel.send(JSObject().apply {
                    put("kind", "error")
                    put("code", "scan-$errorCode")
                    put("message", "Android BLE scan failed with code $errorCode")
                })
                stopActiveScan()
            }
        }
        scanCallback = callback
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        bleScanner.startScan(null, settings, callback)
        scanStop = Runnable { stopActiveScan() }.also { handler.postDelayed(it, args.timeoutMs) }
        invoke.resolve()
    }

    @SuppressLint("MissingPermission")
    private fun emitDevice(result: ScanResult) {
        val device = result.device
        discovered[device.address] = device
        val advertisedServices = JSArray()
        result.scanRecord?.serviceUuids?.forEach { advertisedServices.put(it.uuid.toString()) }
        val payload = JSObject().apply {
            put("kind", "device")
            put("device", JSObject().apply {
                put("address", device.address)
                put("name", result.scanRecord?.deviceName ?: device.name ?: "")
                put("rssi", result.rssi)
                put("isConnected", manager.getConnectionState(device, BluetoothProfile.GATT) == BluetoothProfile.STATE_CONNECTED)
                put("isBonded", device.bondState == BluetoothDevice.BOND_BONDED)
                put("services", advertisedServices)
            })
        }
        scanChannel?.send(payload)
    }

    @SuppressLint("MissingPermission")
    private fun stopActiveScan() {
        val callback = scanCallback ?: return
        scanner?.stopScan(callback)
        scanStop?.let(handler::removeCallbacks)
        scanStop = null
        scanCallback = null
        scanChannel?.send(JSObject().apply { put("kind", "stopped") })
        scanChannel = null
    }

    @Command
    fun stopScan(invoke: Invoke) {
        stopActiveScan()
        invoke.resolve()
    }

    @SuppressLint("MissingPermission")
    @Command
    fun connect(invoke: Invoke) {
        val args = invoke.parseArgs(ConnectArgs::class.java)
        if (!permissionsGranted()) return invoke.reject("permission-required: Bluetooth permission is required")
        if (gatt != null || pendingConnect != null) return invoke.reject("invalid-state: connection already active")
        val device = discovered[args.address]
            ?: return invoke.reject("device-not-found: scan must discover the selected device first")
        stopActiveScan()
        activeAttempt = args.attempt
        disconnectChannel = args.onDisconnect
        pendingConnect = invoke
        gatt = device.connectGatt(activity, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(connection: BluetoothGatt, status: Int, newState: Int) {
            if (connection !== gatt) {
                connection.close()
                return
            }
            when {
                status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED -> {
                    pendingConnect?.resolve()
                    pendingConnect = null
                }
                newState == BluetoothProfile.STATE_DISCONNECTED -> {
                    pendingConnect?.reject(gattError("connection-failed", status))
                    pendingConnect = null
                    emitDisconnect(status)
                    closeGatt()
                }
                status != BluetoothGatt.GATT_SUCCESS -> {
                    pendingConnect?.reject(gattError("connection-failed", status))
                    pendingConnect = null
                    emitDisconnect(status)
                    closeGatt()
                }
            }
        }

        override fun onServicesDiscovered(connection: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                pendingDiscovery?.resolve(JSObject().apply { put("services", serviceArray(connection)) })
            } else {
                pendingDiscovery?.reject(gattError("discovery-failed", status))
            }
            pendingDiscovery = null
        }

        @Deprecated("Used on Android 12 and older")
        override fun onCharacteristicRead(
            connection: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            finishRead(characteristic.value ?: byteArrayOf(), status)
        }

        override fun onCharacteristicRead(
            connection: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int,
        ) {
            finishRead(value, status)
        }

        override fun onDescriptorWrite(
            connection: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int,
        ) {
            val pending = pendingSubscription ?: return
            val operation = pendingDescriptorOperation ?: return
            val errorCode = if (operation == DescriptorOperation.UNSUBSCRIBE) {
                "unsubscribe-failed"
            } else {
                "subscription-failed"
            }
            if (status != BluetoothGatt.GATT_SUCCESS) {
                pending.reject(gattError(errorCode, status))
                if (operation != DescriptorOperation.UNSUBSCRIBE) {
                    notificationChannel = null
                    subscribedCharacteristic = null
                }
                pendingSubscription = null
                pendingDescriptorOperation = null
                return
            }
            if (operation == DescriptorOperation.SUBSCRIBE_RESET) {
                pendingDescriptorOperation = DescriptorOperation.SUBSCRIBE_ENABLE
                if (!writeDescriptor(
                        connection,
                        descriptor,
                        BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE,
                    )
                ) {
                    notificationChannel = null
                    subscribedCharacteristic = null
                    pendingSubscription = null
                    pendingDescriptorOperation = null
                    pending.reject("subscription-failed: Android rejected CCC enable")
                }
                return
            }
            pending.resolve()
            pendingSubscription = null
            pendingDescriptorOperation = null
        }

        @Deprecated("Used on Android 12 and older")
        override fun onCharacteristicChanged(
            connection: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            emitNotification(characteristic, characteristic.value ?: byteArrayOf())
        }

        override fun onCharacteristicChanged(
            connection: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            emitNotification(characteristic, value)
        }
    }

    private fun finish(invoke: Invoke?, status: Int, code: String) {
        if (status == BluetoothGatt.GATT_SUCCESS) invoke?.resolve()
        else invoke?.reject(gattError(code, status))
    }

    private fun finishRead(value: ByteArray, status: Int) {
        if (status == BluetoothGatt.GATT_SUCCESS) {
            pendingRead?.resolve(JSObject().apply { put("bytes", byteArray(value)) })
        } else {
            pendingRead?.reject(gattError("read-failed", status))
        }
        pendingRead = null
    }

    private fun gattError(code: String, status: Int): String {
        val category = when (status) {
            5, 15 -> "security-required"
            17, 143 -> "capacity-unavailable"
            else -> code
        }
        return "$category: Android GATT status $status"
    }

    private fun emitDisconnect(status: Int) {
        disconnectChannel?.send(JSObject().apply {
            put("attempt", activeAttempt)
            put("serviceUuid", "")
            put("characteristicUuid", "")
            put("bytes", JSArray())
            put("status", status)
            put("code", if (status == BluetoothGatt.GATT_SUCCESS) "connection-lost" else gattError("connection-lost", status).substringBefore(':'))
            put("message", "Bluetooth connection lost with Android GATT status $status")
            put("explicit", false)
        })
    }

    private fun emitNotification(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        val service = characteristic.service?.uuid?.toString() ?: return
        notificationChannel?.send(JSObject().apply {
            put("attempt", activeAttempt)
            put("serviceUuid", service)
            put("characteristicUuid", characteristic.uuid.toString())
            put("bytes", byteArray(value))
        })
    }

    @SuppressLint("MissingPermission")
    @Command
    fun listServices(invoke: Invoke) {
        val args = invoke.parseArgs(AttemptArgs::class.java)
        val connection = activeConnection(invoke, args.attempt) ?: return
        if (pendingDiscovery != null) return invoke.reject("invalid-state: GATT operation already active")
        pendingDiscovery = invoke
        if (!connection.discoverServices()) {
            pendingDiscovery = null
            invoke.reject("discovery-failed: Android rejected service discovery")
        }
    }

    private fun serviceArray(connection: BluetoothGatt): JSArray {
        val services = JSArray()
        connection.services.forEach { service ->
            services.put(JSObject().apply {
                put("uuid", service.uuid.toString())
                put("characteristics", JSArray().apply {
                    service.characteristics.forEach { characteristic ->
                        put(JSObject().apply {
                            put("uuid", characteristic.uuid.toString())
                            put("properties", characteristic.properties)
                            put("descriptors", JSArray().apply {
                                characteristic.descriptors.forEach { descriptor -> put(descriptor.uuid.toString()) }
                            })
                        })
                    }
                })
            })
        }
        return services
    }

    @SuppressLint("MissingPermission")
    @Command
    fun read(invoke: Invoke) {
        val args = invoke.parseArgs(GattArgs::class.java)
        val connection = activeConnection(invoke, args.attempt) ?: return
        if (pendingRead != null || pendingSubscription != null) return invoke.reject("invalid-state: GATT operation already active")
        val characteristic = findCharacteristic(connection, args, invoke) ?: return
        pendingRead = invoke
        if (!connection.readCharacteristic(characteristic)) {
            pendingRead = null
            invoke.reject("read-failed: Android rejected characteristic read")
        }
    }

    @SuppressLint("MissingPermission")
    private fun writeDescriptor(
        connection: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        value: ByteArray,
    ): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        connection.writeDescriptor(descriptor, value) == BluetoothGatt.GATT_SUCCESS
    } else {
        @Suppress("DEPRECATION")
        descriptor.value = value
        @Suppress("DEPRECATION")
        connection.writeDescriptor(descriptor)
    }

    @SuppressLint("MissingPermission")
    @Command
    fun subscribe(invoke: Invoke) {
        val args = invoke.parseArgs(SubscribeArgs::class.java)
        val connection = activeConnection(invoke, args.attempt) ?: return
        if (pendingRead != null || pendingSubscription != null) return invoke.reject("invalid-state: GATT operation already active")
        val characteristic = findCharacteristic(connection, args, invoke) ?: return
        val descriptor = characteristic.getDescriptor(CLIENT_CONFIGURATION_UUID)
            ?: return invoke.reject("subscription-failed: characteristic has no CCC descriptor")
        if (!connection.setCharacteristicNotification(characteristic, true)) {
            return invoke.reject("subscription-failed: Android rejected local notification enable")
        }
        notificationChannel = args.onNotification
        subscribedCharacteristic = characteristic
        pendingSubscription = invoke
        pendingDescriptorOperation = DescriptorOperation.SUBSCRIBE_RESET
        val accepted = writeDescriptor(
            connection,
            descriptor,
            BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE,
        )
        if (!accepted) {
            pendingSubscription = null
            pendingDescriptorOperation = null
            notificationChannel = null
            subscribedCharacteristic = null
            invoke.reject("subscription-failed: Android rejected CCC reset")
        }
    }

    @SuppressLint("MissingPermission")
    @Command
    fun unsubscribe(invoke: Invoke) {
        val args = invoke.parseArgs(GattArgs::class.java)
        val connection = activeConnection(invoke, args.attempt) ?: return
        if (pendingRead != null || pendingSubscription != null) return invoke.reject("invalid-state: GATT operation already active")
        val characteristic = subscribedCharacteristic ?: return invoke.resolve()
        val descriptor = characteristic.getDescriptor(CLIENT_CONFIGURATION_UUID)
            ?: return invoke.reject("unsubscribe-failed: characteristic has no CCC descriptor")
        if (!connection.setCharacteristicNotification(characteristic, false)) {
            return invoke.reject("unsubscribe-failed: Android rejected local notification disable")
        }
        notificationChannel = null
        subscribedCharacteristic = null
        pendingSubscription = invoke
        pendingDescriptorOperation = DescriptorOperation.UNSUBSCRIBE
        if (!writeDescriptor(connection, descriptor, BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)) {
            pendingSubscription = null
            pendingDescriptorOperation = null
            invoke.reject("unsubscribe-failed: Android rejected CCC write")
        }
    }

    @SuppressLint("MissingPermission")
    @Command
    fun disconnect(invoke: Invoke) {
        val args = invoke.parseArgs(AttemptArgs::class.java)
        val connection = activeConnection(invoke, args.attempt) ?: return
        activeAttempt += 1
        notificationChannel = null
        subscribedCharacteristic = null
        disconnectChannel = null
        connection.disconnect()
        closeGatt()
        invoke.resolve()
    }

    private fun activeConnection(invoke: Invoke, attempt: Long): BluetoothGatt? {
        val connection = gatt
        if (connection == null) {
            invoke.reject("disconnected: no active GATT connection")
            return null
        }
        if (attempt != activeAttempt) {
            invoke.reject("stale-operation: inactive connection attempt")
            return null
        }
        return connection
    }

    private fun findCharacteristic(
        connection: BluetoothGatt,
        args: GattArgs,
        invoke: Invoke,
    ): BluetoothGattCharacteristic? {
        val service = runCatching { connection.getService(UUID.fromString(args.serviceUuid)) }.getOrNull()
            ?: run {
                invoke.reject("service-not-found: ${args.serviceUuid}")
                return null
            }
        return runCatching { service.getCharacteristic(UUID.fromString(args.characteristicUuid)) }.getOrNull()
            ?: run {
                invoke.reject("characteristic-not-found: ${args.characteristicUuid}")
                null
            }
    }

    private fun permissionsGranted(): Boolean = requiredRuntimePermissions().all {
        ActivityCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun byteArray(bytes: ByteArray): JSArray = JSArray().apply {
        bytes.forEach { put(it.toInt() and 0xff) }
    }

    private fun closeGatt() {
        pendingDiscovery?.reject("disconnected: connection closed")
        pendingRead?.reject("disconnected: connection closed")
        pendingSubscription?.reject("disconnected: connection closed")
        pendingDiscovery = null
        pendingRead = null
        pendingSubscription = null
        pendingDescriptorOperation = null
        gatt?.close()
        gatt = null
    }

    override fun onDestroy() {
        stopActiveScan()
        stopAvailabilityReceiver()
        notificationChannel = null
        subscribedCharacteristic = null
        disconnectChannel = null
        closeGatt()
        super.onDestroy()
    }
}
