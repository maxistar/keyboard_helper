import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { syncAndroidProject } from "../scripts/android-project.mjs";
import { syncAndroidRuntime, validateActivitySource } from "../scripts/android-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const activitySource = path.join(root, "android/runtime/MainActivity.kt");
const iconSource = path.join(root, "android/icons/companion-launcher.svg");
const packageName = "me.maxistar.keyboardhelper.companion";

async function fixture(context, { identity = packageName } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "keyboard-helper-runtime-"));
  context.after(async () => import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })));
  const androidRoot = path.join(directory, "src-tauri/gen/android");
  await mkdir(path.join(androidRoot, "app/src/main/res"), { recursive: true });
  await mkdir(path.join(directory, "src-tauri/icons"), { recursive: true });
  await writeFile(path.join(directory, "src-tauri/icons/icon.png"), "desktop-icon-sentinel");
  await writeFile(
    path.join(androidRoot, "app/build.gradle.kts"),
    `android { namespace = "${identity}"\n defaultConfig { applicationId = "${identity}" } }\n`,
  );
  await writeFile(
    path.join(androidRoot, "app/src/main/AndroidManifest.xml"),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@mipmap/ic_launcher" /></manifest>\n',
  );
  return { directory, androidRoot };
}

async function treeHash(directory) {
  const hash = createHash("sha256");
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(current, entry.name);
      hash.update(path.relative(directory, child));
      if (entry.isDirectory()) await visit(child);
      else hash.update(await readFile(child));
    }
  }
  await visit(directory);
  return hash.digest("hex");
}

test("durable activity owns the edge-to-edge system-bar and display-cutout contract", async () => {
  const source = validateActivitySource(await readFile(activitySource, "utf8"));
  assert.match(source, /package me\.maxistar\.keyboardhelper\.companion/);
  assert.match(source, /Type\.systemBars\(\) or WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(source, /initialTop \+ safeInsets\.top/);
  assert.match(source, /ViewCompat\.requestApplyInsets\(content\)/);
});

test("runtime synchronization is deterministic and installs the stable activity", async (context) => {
  const { androidRoot } = await fixture(context);
  const first = await syncAndroidRuntime({ androidRoot, sourcePath: activitySource });
  const source = await readFile(first.activityPath, "utf8");
  const firstHash = await treeHash(androidRoot);
  await syncAndroidRuntime({ androidRoot, sourcePath: activitySource });
  assert.equal(await treeHash(androidRoot), firstHash);
  assert.equal(first.packageName, packageName);
  assert.equal(source, await readFile(activitySource, "utf8"));
});

test("runtime synchronization rejects missing generated state and identity drift", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "keyboard-helper-runtime-missing-"));
  context.after(async () => import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })));
  await assert.rejects(
    syncAndroidRuntime({ androidRoot: directory, sourcePath: activitySource }),
    /Generated Android project is unavailable.*Run npm run android:init first/,
  );
  const invalid = await fixture(context, { identity: "example.invalid" });
  await assert.rejects(
    syncAndroidRuntime({ androidRoot: invalid.androidRoot, sourcePath: activitySource }),
    /does not use the expected companion package/,
  );
});

test("unified project synchronization installs runtime and launcher without touching desktop identity", async (context) => {
  const { directory, androidRoot } = await fixture(context);
  const result = await syncAndroidProject({ androidRoot, iconSourcePath: iconSource, runtimeSourcePath: activitySource });
  assert.equal(result.runtime.packageName, packageName);
  assert.match(await readFile(result.runtime.activityPath, "utf8"), /WindowInsetsCompat\.Type\.systemBars/);
  assert.match(await readFile(result.launcher.manifestPath, "utf8"), /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.equal(await readFile(path.join(directory, "src-tauri/icons/icon.png"), "utf8"), "desktop-icon-sentinel");
});
