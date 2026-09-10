import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("release publication is downstream of quality, version, and platform packages", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/tauri-release.yml"), "utf8");
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  const beforePublish = workflow.slice(0, workflow.indexOf("\n  publish:"));
  assert.match(publish, /needs: \[quality, prepare, build, android\]/);
  assert.match(publish, /gh release create/);
  assert.match(publish, /--repo "\$GITHUB_REPOSITORY"/);
  assert.doesNotMatch(beforePublish, /gh release create|actions\/create-release/);
  assert.match(workflow, /windows-secondary-window-smoke/);
  assert.match(workflow, /name: Package Android preview \(arm64\)/);
  assert.match(workflow, /ANDROID_KEYSTORE_BASE64/);
  assert.match(workflow, /npm run android:init/);
  assert.match(workflow, /npm run android:configure-signing/);
  assert.match(workflow, /npm run android:write-signing-properties/);
  assert.match(workflow, /npm run android:build:release/);
  assert.match(workflow, /scripts\/stage-android-preview\.mjs/);
  assert.match(workflow, /tauri-release-android-arm64-preview/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});

test("pull-request quality checks exercise Android release support without signing credentials", async () => {
  const quality = await readFile(path.join(root, ".github/workflows/quality.yml"), "utf8");
  assert.match(quality, /pull_request:/);
  assert.match(quality, /npm run check:js/);
  assert.doesNotMatch(quality, /ANDROID_KEYSTORE|secrets\./);
});
