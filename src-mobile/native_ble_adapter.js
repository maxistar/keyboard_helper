export class NativeBleAdapter {
  constructor(tauri = globalThis.window?.__TAURI__) {
    if (!tauri?.core?.invoke || !tauri?.core?.Channel) {
      throw new Error("Tauri mobile API is unavailable.");
    }
    this.invoke = tauri.core.invoke;
    this.Channel = tauri.core.Channel;
    this.attempt = 0;
    this.scanChannel = null;
    this.disconnectChannel = null;
    this.notificationChannel = null;
    this.devices = new Map();
  }

  async checkPermissions(request = false) {
    const command = request ? "request_permissions" : "permission_status";
    const result = await this.invoke(`plugin:keyboard-helper-ble|${command}`);
    return result.state;
  }

  async startScan(handler, timeoutMs) {
    this.devices.clear();
    const channel = new this.Channel();
    channel.onmessage = (event) => {
      if (event.kind === "device") {
        this.devices.set(event.device.address, event.device);
        handler([...this.devices.values()]);
      } else if (event.kind === "error") {
        throw new Error(`${event.code}: ${event.message}`);
      }
    };
    this.scanChannel = channel;
    await this.invoke("plugin:keyboard-helper-ble|start_scan", {
      timeoutMs,
      onEvent: channel,
    });
  }

  async stopScan() {
    await this.invoke("plugin:keyboard-helper-ble|stop_scan");
    this.scanChannel = null;
  }

  async connect(address, onDisconnect) {
    const attempt = ++this.attempt;
    const channel = new this.Channel();
    channel.onmessage = (event) => {
      if (event.attempt === attempt) onDisconnect?.();
    };
    this.disconnectChannel = channel;
    await this.invoke("plugin:keyboard-helper-ble|connect", {
      address,
      attempt,
      onDisconnect: channel,
    });
  }

  async listServices(_address) {
    return this.invoke("plugin:keyboard-helper-ble|list_services", {
      attempt: this.attempt,
    });
  }

  async read(characteristicUuid, serviceUuid) {
    return this.invoke("plugin:keyboard-helper-ble|read", {
      attempt: this.attempt,
      serviceUuid,
      characteristicUuid,
    });
  }

  async subscribe(characteristicUuid, serviceUuid, handler) {
    const attempt = this.attempt;
    const channel = new this.Channel();
    channel.onmessage = (event) => {
      if (event.attempt === attempt) handler(event.bytes);
    };
    this.notificationChannel = channel;
    await this.invoke("plugin:keyboard-helper-ble|subscribe", {
      attempt,
      serviceUuid,
      characteristicUuid,
      onNotification: channel,
    });
  }

  async unsubscribe(characteristicUuid, serviceUuid) {
    await this.invoke("plugin:keyboard-helper-ble|unsubscribe", {
      attempt: this.attempt,
      serviceUuid,
      characteristicUuid,
    });
    this.notificationChannel = null;
  }

  async disconnect() {
    const attempt = this.attempt;
    await this.invoke("plugin:keyboard-helper-ble|disconnect", { attempt });
    this.attempt += 1;
    this.disconnectChannel = null;
    this.notificationChannel = null;
  }
}
