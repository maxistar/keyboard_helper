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
  assert.match(publish, /needs: \[quality, prepare, build\]/);
  assert.match(publish, /gh release create/);
  assert.doesNotMatch(beforePublish, /gh release create|actions\/create-release/);
  assert.match(workflow, /windows-secondary-window-smoke/);
});
