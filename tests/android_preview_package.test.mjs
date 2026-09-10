import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  androidVersionCode,
  normalizeFingerprint,
  stageAndroidPreview,
  verifyAndroidPreviewApk,
  verifyAndroidPreviewEvidence,
} from "../scripts/android-preview-package.mjs";

const fingerprint = "12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF";

function evidence(overrides = {}) {
  return {
    badging: [
      "package: name='me.maxistar.keyboardhelper.companion' versionCode='5000' versionName='0.5.0'",
      "sdkVersion:'24'",
      "application-label:'Keyboard Helper Companion'",
      "native-code: 'arm64-v8a'",
    ].join("\n"),
    signerOutput: `Verifies\nSigner #1 certificate SHA-256 digest: ${fingerprint}`,
    zipEntries: "lib/arm64-v8a/libkeyboard_app_lib.so\nassets/index.html\n",
    ...overrides,
  };
}

test("derives the Android version code from semantic version", () => {
  assert.equal(androidVersionCode("0.5.0"), 5000);
  assert.equal(androidVersionCode("2.3.4"), 2_003_004);
  assert.throws(() => androidVersionCode("0.5.0-beta.1"), /plain semantic version/);
});

test("accepts matching release metadata, ABI, and signer", () => {
  const result = verifyAndroidPreviewEvidence(evidence(), { version: "0.5.0", fingerprint });
  assert.equal(result.applicationId, "me.maxistar.keyboardhelper.companion");
  assert.deepEqual(result.archiveAbis, ["arm64-v8a"]);
  assert.equal(result.signerFingerprint, normalizeFingerprint(fingerprint));
});

for (const [name, mutate, expected] of [
  ["application identity", (value) => value.replace("me.maxistar.keyboardhelper.companion", "invalid.app"), /Application ID mismatch/],
  ["display name", (value) => value.replace("Keyboard Helper Companion", "Debug Companion"), /Display name mismatch/],
  ["version", (value) => value.replace("versionName='0.5.0'", "versionName='0.4.0'"), /Version name mismatch/],
  ["version code", (value) => value.replace("versionCode='5000'", "versionCode='4000'"), /Version code mismatch/],
  ["minimum SDK", (value) => value.replace("sdkVersion:'24'", "sdkVersion:'26'"), /Minimum SDK mismatch/],
  ["aapt ABI", (value) => value.replace("'arm64-v8a'", "'armeabi-v7a'"), /aapt native ABI scope mismatch/],
]) {
  test(`blocks mismatched ${name}`, () => {
    const original = evidence();
    assert.throws(
      () => verifyAndroidPreviewEvidence({ ...original, badging: mutate(original.badging) }, { version: "0.5.0", fingerprint }),
      expected,
    );
  });
}

test("blocks extra archive ABIs and a mismatched signer", () => {
  assert.throws(
    () => verifyAndroidPreviewEvidence(evidence({ zipEntries: "lib/arm64-v8a/lib.so\nlib/x86_64/lib.so\n" }), { version: "0.5.0", fingerprint }),
    /archive native ABI scope mismatch/,
  );
  assert.throws(
    () => verifyAndroidPreviewEvidence(evidence(), { version: "0.5.0", fingerprint: "AA".repeat(32) }),
    /Signer fingerprint mismatch/,
  );
});

test("blocks debug inputs and a failed signature inspection", async () => {
  await assert.rejects(
    () => verifyAndroidPreviewApk("app-debug.apk", { version: "0.5.0", fingerprint }),
    /debug or non-APK input is not publishable/,
  );
  await assert.rejects(
    () => verifyAndroidPreviewApk("app-release.apk", { version: "0.5.0", fingerprint }, {
      run(command) {
        if (command === "apksigner") throw new Error("signature verification failed");
        return command === "aapt" ? evidence().badging : evidence().zipEntries;
      },
    }),
    /signature verification failed/,
  );
});

test("stages exactly one verified APK with canonical name and checksum", async (context) => {
  const testRoot = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "keyboard-helper-apk-")));
  context.after(async () => import("node:fs/promises").then(({ rm }) => rm(testRoot, { recursive: true, force: true })));
  const input = path.join(testRoot, "input");
  const output = path.join(testRoot, "output");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(input));
  await writeFile(path.join(input, "app-release.apk"), "signed fixture", "utf8");

  const result = await stageAndroidPreview({
    inputDirectory: input,
    outputDirectory: output,
    version: "0.5.0",
    fingerprint,
    verify: async () => ({ applicationId: "me.maxistar.keyboardhelper.companion" }),
  });
  assert.equal(path.basename(result.artifactPath), "Keyboard-Helper-Companion_0.5.0_android-arm64_preview.apk");
  assert.match(await readFile(result.checksumPath, "utf8"), /^[0-9a-f]{64} {2}Keyboard-Helper-Companion_0\.5\.0_android-arm64_preview\.apk\n$/);
  await writeFile(path.join(input, "extra.apk"), "unexpected", "utf8");
  await assert.rejects(
    () => stageAndroidPreview({ inputDirectory: input, outputDirectory: output, version: "0.5.0", fingerprint }),
    /Expected exactly one APK.*found 2/,
  );
});
