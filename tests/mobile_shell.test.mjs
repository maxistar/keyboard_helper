import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("Android configuration keeps a distinct companion identity and frontend", async () => {
  const desktop = JSON.parse(await read("src-tauri/tauri.conf.json"));
  const android = JSON.parse(await read("src-tauri/tauri.android.conf.json"));
  const macos = JSON.parse(await read("src-tauri/tauri.macos.conf.json"));

  assert.equal(desktop.identifier, "me.maxistar.keyri-app");
  assert.equal(desktop.app.macOSPrivateApi, false);
  assert.equal(macos.app.macOSPrivateApi, true);
  assert.equal(android.productName, "Keyboard Helper Companion");
  assert.equal(android.identifier, "me.maxistar.keyboardhelper.companion");
  assert.equal(android.build.frontendDist, "../src-mobile");
  assert.equal(android.bundle.android.minSdkVersion, 24);
  assert.deepEqual(android.app.windows.map(({ label }) => label), ["mobile"]);
  assert.equal(android.app.macOSPrivateApi, false);
});

test("mobile surface composes the product connection overview and independent viewer", async () => {
  const html = await read("src-mobile/index.html");
  const app = await read("src-mobile/app.js");

  assert.match(html, /data-surface="mobile-connection-overview"/);
  assert.match(html, /data-viewer="mobile-layout-viewer"/);
  assert.match(html, /No keyboard connection is required/);
  assert.match(html, /Keyboard Helper Companion/);
  assert.match(html, /Find keyboard/);
  assert.match(html, /Keyboard details/);
  assert.doesNotMatch(html, /Discover and read|Subscribe to events|Latest notification/);
  assert.match(html, /src="app\.js"/);
  assert.doesNotMatch(html, /main\.js|greet|overlay|typing-invaders|self-test|remote layer|write layer/i);
  assert.match(app, /ConnectionEvidenceController/);
  assert.match(app, /createMobileConnectionOverviewView/);
  assert.match(app, /createMobileLayoutViewerView\(document, viewerModel, presentation\)/);
  assert.match(app, /querySelectorAll\("\.connection-card button"\)/);
  assert.doesNotMatch(app, /querySelectorAll\("button"\)/);
});

test("mobile runtime imports remain inside the packaged frontend", async () => {
  const telemetry = await read("src-mobile/telemetry_session.js");
  const canonicalDecoder = await read("src/ble_keyboard_decoder.js");
  const canonicalEvents = await read("src/input_events.js");
  const packagedDecoder = await read("src-mobile/shared-generated/ble_keyboard_decoder.js");
  const packagedEvents = await read("src-mobile/shared-generated/input_events.js");

  assert.equal(packagedDecoder, canonicalDecoder);
  assert.equal(packagedEvents, canonicalEvents);
  assert.match(telemetry, /\.\/shared-generated\/ble_keyboard_decoder\.js/);
  assert.doesNotMatch(telemetry, /\.\.\/src\//);

  for (const source of [telemetry, packagedDecoder]) {
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const importer = source === telemetry
        ? path.join(root, "src-mobile", "telemetry_session.js")
        : path.join(root, "src-mobile", "shared-generated", "ble_keyboard_decoder.js");
      const resolved = path.resolve(path.dirname(importer), match[1]);
      assert.ok(resolved.startsWith(path.join(root, "src-mobile") + path.sep));
      await access(resolved);
    }
  }
});

test("mobile capability grants only the foreground transport plugin", async () => {
  const capability = JSON.parse(await read("src-tauri/capabilities/mobile-shell.json"));
  const desktopCapabilities = await Promise.all(
    ["default", "self-test", "settings", "typing-invaders"].map(async (name) =>
      JSON.parse(await read(`src-tauri/capabilities/${name}.json`)),
    ),
  );

  assert.deepEqual(capability.windows, ["mobile"]);
  assert.deepEqual(capability.platforms, ["android"]);
  assert.deepEqual(capability.permissions, ["core:default", "keyboard-helper-ble:default"]);
  assert.doesNotMatch(JSON.stringify(capability), /notification|background|write/i);
  for (const desktopCapability of desktopCapabilities) {
    assert.deepEqual(desktopCapability.platforms, ["macOS", "windows", "linux"]);
  }
});

test("mobile native entry registers only the target-gated BLE adapter", async () => {
  const mobileRust = await read("src-tauri/src/lib.rs");
  const cargoToml = await read("src-tauri/Cargo.toml");

  assert.match(mobileRust, /mobile_entry_point/);
  assert.match(mobileRust, /Keyboard Helper Companion/);
  assert.match(mobileRust, /cfg\(target_os = "android"\)/);
  assert.match(mobileRust, /tauri_plugin_keyboard_helper_ble::init/);
  assert.doesNotMatch(mobileRust, /greet|invoke_handler|rdev|tray|ble_layer|input_source/i);
  assert.match(cargoToml, /cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)/);
  assert.match(cargoToml, /cfg\(target_os = "android"\)[\s\S]*tauri-plugin-keyboard-helper-ble/);
  assert.match(cargoToml, /cfg\(target_os = "macos"\)[\s\S]*macos-private-api/);
});

test("Android notification enrollment resets CCC and teardown confirms remote disable", async () => {
  const plugin = await read(
    "plugins/tauri-plugin-keyboard-helper-ble/android/src/main/java/KeyboardHelperBlePlugin.kt",
  );

  assert.match(plugin, /BluetoothGattDescriptor\.ENABLE_NOTIFICATION_VALUE/);
  assert.match(plugin, /BluetoothGattDescriptor\.DISABLE_NOTIFICATION_VALUE/);
  assert.match(plugin, /DescriptorOperation\.SUBSCRIBE_RESET/);
  assert.match(plugin, /DescriptorOperation\.SUBSCRIBE_ENABLE/);
  assert.match(plugin, /DescriptorOperation\.UNSUBSCRIBE/);
  assert.match(
    plugin,
    /pendingDescriptorOperation = DescriptorOperation\.SUBSCRIBE_RESET[\s\S]*BluetoothGattDescriptor\.DISABLE_NOTIFICATION_VALUE/,
  );
  assert.match(
    plugin,
    /operation == DescriptorOperation\.SUBSCRIBE_RESET[\s\S]*BluetoothGattDescriptor\.ENABLE_NOTIFICATION_VALUE/,
  );
  assert.doesNotMatch(
    plugin,
    /fun unsubscribe\(invoke: Invoke\)[\s\S]*?subscribedCharacteristic = null\s*invoke\.resolve\(\)/,
  );
});

test("generated mobile projects remain reproducible ignored state", async () => {
  const gitignore = await read(".gitignore");
  const packageJson = JSON.parse(await read("package.json"));

  assert.match(gitignore, /^src-tauri\/gen$/m);
  assert.equal(
    packageJson.scripts["android:init"],
    "tauri android init --ci --skip-targets-install",
  );
  assert.equal(packageJson.scripts["android:dev"], "tauri android dev");
  assert.equal(
    packageJson.scripts["android:build"],
    "tauri android build --debug --target aarch64 --apk true --aab false --ci",
  );
});
