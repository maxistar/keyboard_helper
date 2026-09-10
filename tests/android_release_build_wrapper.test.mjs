import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runWithRestoredFile } from "../scripts/run-android-release-build.mjs";

async function fixture(context) {
  const directory = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "keyboard-helper-manifest-")));
  context.after(async () => import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })));
  const manifest = path.join(directory, "Cargo.toml");
  await writeFile(manifest, "desktop manifest\n", "utf8");
  return manifest;
}

test("Android release runner restores a manifest changed by Tauri", async (context) => {
  const manifest = await fixture(context);
  const result = await runWithRestoredFile(manifest, async () => {
    await writeFile(manifest, "android temporary manifest\n", "utf8");
    return "built";
  });
  assert.equal(result, "built");
  assert.equal(await readFile(manifest, "utf8"), "desktop manifest\n");
});

test("Android release runner restores the manifest after a failed build", async (context) => {
  const manifest = await fixture(context);
  await assert.rejects(
    () => runWithRestoredFile(manifest, async () => {
      await writeFile(manifest, "android temporary manifest\n", "utf8");
      throw new Error("build failed");
    }),
    /build failed/,
  );
  assert.equal(await readFile(manifest, "utf8"), "desktop manifest\n");
});

