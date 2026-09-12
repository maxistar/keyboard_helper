import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package authoring contract and generator stay aligned", async () => {
  const [manifest, cases, docs, generator, native] = await Promise.all([
    readFile(path.join(root, "tests/fixtures/layout-packages/v1/manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "tests/fixtures/layout-packages/rejection-cases.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "docs/mobile-layout-package.md"), "utf8"),
    readFile(path.join(root, "scripts/build-mobile-layout-package.mjs"), "utf8"),
    readFile(path.join(root, "plugins/tauri-plugin-keyboard-helper-layouts/android/src/main/java/LayoutPackageSupport.kt"), "utf8"),
  ]);
  assert.deepEqual(manifest, { format: "keyboard-helper-layout-package", version: 1, layout: "layout.json" });
  assert.ok(cases.unsafePaths.length >= 4 && cases.unsupportedImages.length >= 2);
  for (const value of ["2 MiB", "64", "8 MiB", "512 KiB", "1 MiB", "2048 × 2048", "100:1"])
    assert.ok(docs.includes(value), value);
  for (const value of ["keyboard-helper-layout-package", "manifest.json"])
    assert.ok(generator.includes(value) && native.includes(value), value);
  assert.ok(generator.includes("layout.json"));
  assert.ok(generator.includes("assets/images/") && native.includes("assets/"));
});

test("Corney package generator emits a bounded inspectable archive", async (context) => {
  if (process.platform === "win32") return context.skip("Archive listing assertion uses unzip on Unix CI.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "khlayout-"));
  const output = path.join(directory, "corney.khlayout");
  try {
    const generated = spawnSync(process.execPath, [path.join(root, "scripts/build-mobile-layout-package.mjs"), output], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const listing = spawnSync("unzip", ["-l", output], { encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    for (const entry of ["manifest.json", "layout.json", "linux-logo-penguin.png", "apple_rainbow.png", "android-logo.png"])
      assert.ok(listing.stdout.includes(entry), entry);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
