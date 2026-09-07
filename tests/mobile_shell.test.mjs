import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("mobile surface is bounded to bootstrap status", async () => {
  const html = await read("src-mobile/index.html");

  assert.match(html, /data-surface="android-companion-shell"/);
  assert.match(html, /Keyboard Helper Companion/);
  assert.match(html, /Mobile shell ready/);
  assert.doesNotMatch(html, /main\.js|greet|overlay|typing-invaders|self-test|remote layer/i);
  assert.doesNotMatch(html, /<script\b/i);
});

test("mobile capability grants no deferred companion permissions", async () => {
  const capability = JSON.parse(await read("src-tauri/capabilities/mobile-shell.json"));
  const desktopCapabilities = await Promise.all(
    ["default", "self-test", "settings", "typing-invaders"].map(async (name) =>
      JSON.parse(await read(`src-tauri/capabilities/${name}.json`)),
    ),
  );

  assert.deepEqual(capability.windows, ["mobile"]);
  assert.deepEqual(capability.platforms, ["android"]);
  assert.deepEqual(capability.permissions, ["core:default"]);
  assert.doesNotMatch(JSON.stringify(capability), /bluetooth|scan|location|notification|background/i);
  for (const desktopCapability of desktopCapabilities) {
    assert.deepEqual(desktopCapability.platforms, ["macOS", "windows", "linux"]);
  }
});

test("mobile native entry has no demonstration or desktop service registration", async () => {
  const mobileRust = await read("src-tauri/src/lib.rs");
  const cargoToml = await read("src-tauri/Cargo.toml");

  assert.match(mobileRust, /mobile_entry_point/);
  assert.match(mobileRust, /Keyboard Helper Companion/);
  assert.doesNotMatch(mobileRust, /greet|plugin\(|invoke_handler|rdev|tray|ble_|input_source/i);
  assert.match(cargoToml, /cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)/);
  assert.match(cargoToml, /cfg\(target_os = "macos"\)[\s\S]*macos-private-api/);
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
