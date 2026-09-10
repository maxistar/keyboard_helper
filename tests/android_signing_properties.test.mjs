import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  escapeJavaPropertyValue,
  writeAndroidSigningProperties,
} from "../scripts/write-android-signing-properties.mjs";

test("Java signing property values escape separators and control characters", () => {
  assert.equal(escapeJavaPropertyValue("  a:b=c\\d#e!f\n"), "\\ \\ a\\:b\\=c\\\\d\\#e\\!f\\n");
});

test("signing properties contain all four encoded values and are private on POSIX", async (context) => {
  const directory = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "keyboard-helper-signing-")));
  context.after(async () => import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true })));
  const output = path.join(directory, "keystore.properties");
  await writeAndroidSigningProperties(output, {
    ANDROID_KEYSTORE_FILE: "/tmp/key:store.jks",
    ANDROID_KEYSTORE_PASSWORD: "store=secret",
    ANDROID_KEY_ALIAS: "preview",
    ANDROID_KEY_PASSWORD: "key#secret",
  });
  const content = await readFile(output, "utf8");
  assert.equal(content, [
    "storeFile=/tmp/key\\:store.jks",
    "storePassword=store\\=secret",
    "keyAlias=preview",
    "keyPassword=key\\#secret",
    "",
  ].join("\n"));
  const outputStat = await stat(output);
  assert.equal(outputStat.isFile(), true);
  if (process.platform !== "win32") {
    assert.equal(outputStat.mode & 0o777, 0o600);
  }
});

test("missing-input diagnostics name fields without emitting supplied values", async () => {
  await assert.rejects(
    () => writeAndroidSigningProperties("unused", { ANDROID_KEYSTORE_PASSWORD: "do-not-print-me" }),
    (error) => {
      assert.match(error.message, /storeFile, keyAlias, keyPassword/);
      assert.doesNotMatch(error.message, /do-not-print-me/);
      return true;
    },
  );
});
