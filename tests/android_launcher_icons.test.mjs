import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  configureManifest,
  parseIconSource,
  syncAndroidLauncherIcons,
} from "../scripts/android-launcher-icons.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "android/icons/companion-launcher.svg");
const expectedSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function fixture(context, { validManifest = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "keyboard-helper-icons-"));
  context.after(async () => import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })));
  const androidRoot = path.join(directory, "src-tauri/gen/android");
  await mkdir(path.join(androidRoot, "app/src/main/res"), { recursive: true });
  await mkdir(path.join(directory, "src-tauri/icons"), { recursive: true });
  await writeFile(path.join(directory, "src-tauri/icons/icon.png"), "desktop-icon-sentinel");
  await writeFile(
    path.join(androidRoot, "app/src/main/AndroidManifest.xml"),
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application ${validManifest ? 'android:icon="@mipmap/ic_launcher"' : ""} android:label="@string/app_name" /></manifest>\n`,
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

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test("durable launcher source defines six mask-safe rounded keycaps without text", async () => {
  const source = await readFile(sourcePath, "utf8");
  const icon = parseIconSource(source);
  assert.equal(icon.keys.length, 6);
  assert.equal(new Set(icon.keys.map(({ id }) => id)).size, 6);
  assert.ok(icon.keys.every((key) => key.radius > 0 && key.x >= 21 && key.y >= 21));
  assert.ok(icon.keys.every((key) => key.x + key.width <= 87 && key.y + key.height <= 87));
  assert.doesNotMatch(source, /<text\b/i);
});

test("synchronization installs adaptive, monochrome, round, and legacy launcher resources", async (context) => {
  const { androidRoot } = await fixture(context);
  const result = await syncAndroidLauncherIcons({ androidRoot, sourcePath });
  assert.deepEqual(result.densities, expectedSizes);
  const resourceRoot = path.join(androidRoot, "app/src/main/res");
  const foreground = await readFile(path.join(resourceRoot, "drawable/ic_launcher_foreground.xml"), "utf8");
  const monochrome = await readFile(path.join(resourceRoot, "drawable/ic_launcher_monochrome.xml"), "utf8");
  const adaptive = await readFile(path.join(resourceRoot, "mipmap-anydpi-v26/ic_launcher.xml"), "utf8");
  const themed = await readFile(path.join(resourceRoot, "mipmap-anydpi-v33/ic_launcher.xml"), "utf8");
  assert.match(foreground, /#2DD4BF/);
  assert.match(foreground, /#FBBF24/);
  assert.doesNotMatch(monochrome, /#2DD4BF|#FBBF24/);
  assert.match(adaptive, /@drawable\/ic_launcher_background/);
  assert.doesNotMatch(adaptive, /monochrome/);
  assert.match(themed, /<monochrome android:drawable="@drawable\/ic_launcher_monochrome"/);
  for (const [density, size] of Object.entries(expectedSizes)) {
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      assert.deepEqual(pngDimensions(await readFile(path.join(resourceRoot, `mipmap-${density}`, name))), [size, size]);
    }
  }
  const manifest = await readFile(path.join(androidRoot, "app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
});

test("synchronization is deterministic and does not touch desktop or mobile workspace identity", async (context) => {
  const { directory, androidRoot } = await fixture(context);
  const desktopIcon = path.join(directory, "src-tauri/icons/icon.png");
  const beforeDesktop = await readFile(desktopIcon);
  await syncAndroidLauncherIcons({ androidRoot, sourcePath });
  const first = await treeHash(androidRoot);
  await syncAndroidLauncherIcons({ androidRoot, sourcePath });
  assert.equal(await treeHash(androidRoot), first);
  assert.deepEqual(await readFile(desktopIcon), beforeDesktop);
  const mobileHtml = await readFile(path.join(root, "src-mobile/index.html"), "utf8");
  const appBar = mobileHtml.match(/<header class="workspace-app-bar">([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.doesNotMatch(appBar, /keyboard-mark|<h1>|>Companion</);
});

test("missing or incompatible generated Android projects fail with actionable diagnostics", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "keyboard-helper-icons-missing-"));
  context.after(async () => import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })));
  await assert.rejects(
    () => syncAndroidLauncherIcons({ androidRoot: directory, sourcePath }),
    /Generated Android project is unavailable.*Run npm run android:init first/,
  );
  const invalid = await fixture(context, { validManifest: false });
  await assert.rejects(
    () => syncAndroidLauncherIcons({ androidRoot: invalid.androidRoot, sourcePath }),
    /Expected exactly one Android launcher icon anchor, found 0/,
  );
});

test("manifest configuration is idempotent and rejects duplicate icon anchors", () => {
  const source = '<application android:icon="@mipmap/ic_launcher" />';
  const once = configureManifest(source);
  assert.equal(configureManifest(once), once);
  assert.throws(() => configureManifest(`${source}${source}`), /found 2/);
});
