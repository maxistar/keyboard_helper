const COMMAND_PREFIX = "plugin:keyboard-helper-layouts|";

export class NativeLayoutAdapter {
  constructor(tauri = globalThis.window?.__TAURI__) {
    this.invoke = tauri?.core?.invoke ?? null;
  }

  get available() { return typeof this.invoke === "function"; }

  requireAvailable() {
    if (!this.available) throw new Error("Custom layout storage is unavailable on this platform.");
  }

  async pickLayout() {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}pick_layout`);
  }

  async listRecords() {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}list_records`);
  }

  async writeRecord(record) {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}write_record`, { record });
  }

  async commitPackage(token, record) {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}commit_package`, { token, record });
  }

  async discardPackage(token) {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}discard_package`, { token });
  }

  async readAsset(id, path) {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}read_asset`, { id, path });
  }

  async removeRecord(id) {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}remove_record`, { id });
  }

  async readSelection() {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}read_selection`);
  }

  async writeSelection(selection) {
    this.requireAvailable();
    return this.invoke(`${COMMAND_PREFIX}write_selection`, { selection });
  }
}
