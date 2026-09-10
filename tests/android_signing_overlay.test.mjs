import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { configureAndroidSigning } from "../scripts/configure-android-signing.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = `import java.util.Properties

android {
    defaultConfig {
        applicationId = "me.maxistar.keyboardhelper.companion"
    }
    buildTypes {
        getByName("debug") {
            isDebuggable = true
        }
        getByName("release") {
            isMinifyEnabled = true
        }
    }
}
`;

const [signingConfigFragment, releaseBuildTypeFragment] = await Promise.all([
  readFile(path.join(root, "android/signing/signing-config.gradle.kts"), "utf8"),
  readFile(path.join(root, "android/signing/release-build-type.gradle.kts"), "utf8"),
]);

function configure(source) {
  return configureAndroidSigning(source, signingConfigFragment, releaseBuildTypeFragment);
}

test("configures clean generated Gradle input exactly once", () => {
  const result = configure(fixture);
  assert.equal(result.changed, true);
  assert.match(result.content, /signingConfigs \{/);
  assert.match(result.content, /signingConfig = signingConfigs\.getByName\("release"\)/);
  assert.equal(result.content.match(/KEYBOARD_HELPER_ANDROID_SIGNING_CONFIG_START/g)?.length, 1);
});

test("repeated configuration is idempotent", () => {
  const first = configure(fixture);
  const second = configure(first.content);
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("missing or changed anchors fail closed", () => {
  assert.throws(
    () => configure(fixture.replace("    buildTypes {", "    buildTypes  {")),
    /Expected exactly one buildTypes anchor, found 0/,
  );
  assert.throws(
    () => configure(fixture.replace('getByName("release")', 'named("release")')),
    /Expected exactly one release build type anchor, found 0/,
  );
});

test("duplicate anchors fail closed", () => {
  assert.throws(
    () => configure(fixture.replace("    buildTypes {", "    buildTypes {\n    buildTypes {")),
    /Expected exactly one buildTypes anchor, found 2/,
  );
});

test("partial and duplicated signing overlays fail without secret values", () => {
  const partial = fixture.replace(
    "    buildTypes {",
    "    // KEYBOARD_HELPER_ANDROID_SIGNING_CONFIG_START\n    buildTypes {",
  );
  assert.throws(() => configure(partial), (error) => {
    assert.match(error.message, /partial or duplicated/);
    assert.doesNotMatch(error.message, /storePassword|keyPassword|secret/i);
    return true;
  });

  const configured = configure(fixture).content;
  assert.throws(
    () => configure(`${configured}\n// KEYBOARD_HELPER_ANDROID_SIGNING_CONFIG_START\n`),
    /partial or duplicated/,
  );
});
