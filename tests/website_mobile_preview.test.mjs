import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("Android release view gates unpublished and adaptive-workspace claims", async () => {
  const releaseModule = await import(pathToFileURL(path.join(root, "website/src/data/releases.js")));
  const { androidPreview, getAndroidPreviewView, releasesUrl } = releaseModule;

  assert.equal(androidPreview.published, true);
  assert.equal(androidPreview.version, "v0.6.4");
  assert.match(androidPreview.releaseUrl, /releases\/tag\/v0\.6\.4$/);
  assert.equal(androidPreview.capabilities.adaptiveWorkspace, false);

  const unpublished = getAndroidPreviewView({
    published: false,
    version: "v-next",
    releaseUrl: "https://invalid.example/download.apk",
    capabilities: { adaptiveWorkspace: true },
  });
  assert.deepEqual(unpublished, {
    published: false,
    version: null,
    releaseUrl: releasesUrl,
    adaptiveWorkspace: false,
    status: "No verified Android preview is currently published.",
  });

  const futurePublished = getAndroidPreviewView({
    published: true,
    version: "v0.7.0",
    releaseUrl: `${releasesUrl}/tag/v0.7.0`,
    capabilities: { adaptiveWorkspace: true },
  });
  assert.equal(futurePublished.published, true);
  assert.equal(futurePublished.version, "v0.7.0");
  assert.equal(futurePublished.adaptiveWorkspace, true);
  assert.match(futurePublished.status, /Signed v0\.7\.0 preview/);
});

test("dedicated Android route, legacy setup bridge, and primary navigation are base-path safe", async () => {
  const [layout, index, setup, android] = await Promise.all([
    source("website/src/layouts/Layout.astro"),
    source("website/src/pages/index.astro"),
    source("website/src/pages/setup.astro"),
    source("website/src/pages/android.astro"),
  ]);

  await access(path.join(root, "website/src/pages/android.astro"));
  for (const href of ["/", "/setup/", "/android/", "/faq/"]) {
    assert.ok(layout.includes(`href={\`${"${base}"}${href}\`}`), `navigation ${href}`);
  }
  assert.match(layout, /aria-label="Primary navigation"/);
  assert.match(index, /href={`\$\{base\}\/android\/`}/);
  assert.match(setup, /id="android-preview"/);
  assert.match(setup, /href={`\$\{base\}\/android\/`}/);
  assert.match(setup, /complete Android Companion guide/i);
  assert.match(android, /const base = import\.meta\.env\.BASE_URL/);
});

test("landing page presents separate desktop and Android outcomes without future promises", async () => {
  const index = await source("website/src/pages/index.astro");
  for (const phrase of ["Desktop overlay", "Android Companion", "foreground Android companion", "Browse layouts", "Connection evidence", "Compatible Live"]) {
    assert.match(index, new RegExp(phrase, "i"));
  }
  assert.match(index, /iOS[\s\S]*Unavailable[\s\S]*no iOS build[\s\S]*promised availability date/i);
  assert.match(index, /androidRelease\.adaptiveWorkspace \?/);
  assert.match(index, /Later release preview — not in/);
  assert.match(index, /never switches the keyboard's remote layer/i);
  assert.doesNotMatch(index, /href=["'][^"']*\.apk/);
});

test("Android guide covers installation, stable anchors, workspace gating, layouts, Live, and compatibility", async () => {
  const android = await source("website/src/pages/android.astro");
  for (const id of ["installation", "connection", "workspace", "layouts", "live", "compatibility", "troubleshooting"]) {
    assert.match(android, new RegExp(`id=["']${id}["']`), id);
    assert.match(android, new RegExp(`href=["']#${id}["']`), `${id} link`);
  }
  for (const phrase of ["SHA-256", "unknown-app", "Nearby devices", "debug APK", "foreground-only", "Settings &gt; Connection", "Settings &gt; Layouts", "Settings &gt; Status"]) {
    assert.match(android, new RegExp(phrase, "i"), phrase);
  }
  for (const phrase of ["keyboard-helper-layout", "embeddedAssets", "asset:&lt;id&gt;", "PNG", "JPEG", "WebP", "1 MiB", "128 KiB", "512 KiB", "16 assets", "256 × 256", "private app storage"]) {
    assert.ok(android.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()), phrase);
  }
  assert.match(android, /\.khlayout[\s\S]*unsupported preview format[\s\S]*no migration/i);
  assert.match(android, /API 31\+[\s\S]*Android 11 \/ API 30[\s\S]*not a claim of accepted physical BLE support/i);
  assert.match(android, /sequence gap/i);
  assert.match(android, /unsupported-protocol errors/i);
  assert.match(android, /bundled default/i);
});

test("Android screenshot slots are accessible, discoverable, and release-gated", async () => {
  const [index, imageReadme] = await Promise.all([
    source("website/src/pages/index.astro"),
    source("website/public/images/README.md"),
  ]);
  for (const file of ["android-browse.png", "android-settings.png", "android-live.png"]) {
    assert.match(index, new RegExp(file.replace(".", "\\.")), file);
    assert.match(imageReadme, new RegExp(file.replace(".", "\\.")), `${file} documentation`);
  }
  assert.match(index, /androidRelease\.adaptiveWorkspace \?/);
  assert.match(index, /role="img" aria-label={shot\.text}/);
  assert.match(index, /public\/images\/\{shot\.file\}/);
  assert.match(index, /shot\.available \?/);
});

test("FAQ stays concise, platform-scoped, and routes detailed Android recovery", async () => {
  const faq = await source("website/src/pages/faq.astro");
  for (const phrase of ["macOS · Desktop app", "Android preview · BLE-dependent", "Enhanced firmware", "Diagnostic limit", "Practice mode"]) {
    assert.match(faq, new RegExp(phrase, "i"), phrase);
  }
  for (const anchor of ["installation", "troubleshooting", "live", "layouts"]) {
    assert.ok(faq.includes('href={`${base}/android/#' + anchor + '`}'), anchor);
  }
  assert.match(faq, /likely cause/i);
  assert.match(faq, /next action/i);
  assert.doesNotMatch(faq, /128 KiB|512 KiB|256 × 256|16 assets/);
});

test("shared navigation and page grids have explicit narrow-screen and keyboard focus behavior", async () => {
  const [layout, index, android] = await Promise.all([
    source("website/src/layouts/Layout.astro"),
    source("website/src/pages/index.astro"),
    source("website/src/pages/android.astro"),
  ]);
  assert.match(layout, /a:focus-visible/);
  assert.match(layout, /:global\(\*\)[^{]*\{ box-sizing: border-box/);
  assert.match(layout, /@media \(max-width: 560px\)/);
  assert.match(layout, /flex-wrap: wrap/);
  assert.match(layout, /flex-direction: column/);
  assert.match(layout, /main \{ padding: 34px 18px; \}/);
  assert.match(index, /minmax\(min\(100%, 250px\), 1fr\)/);
  assert.match(index, /@media \(max-width: 420px\)/);
  assert.match(android, /minmax\(min\(100%, 230px\), 1fr\)/);
});

test("website production build runs base-path route, asset, and fragment validation", async () => {
  const [packageJson, validator] = await Promise.all([
    source("website/package.json"),
    source("website/scripts/validate-built-site.mjs"),
  ]);
  assert.match(packageJson, /astro build && node scripts\/validate-built-site\.mjs/);
  assert.match(validator, /\/keyboard_helper/);
  assert.match(validator, /(?:href\|src)/);
  assert.match(validator, /fragment/);
});
