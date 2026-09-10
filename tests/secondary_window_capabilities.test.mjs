import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SECONDARY_WINDOWS } from "../src/secondary_window_ready.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every dynamic secondary window has a page, capability, and Rust label", async () => {
  const rust = await readFile(path.join(root, "src-tauri/src/main.rs"), "utf8");
  for (const window of Object.values(SECONDARY_WINDOWS)) {
    await readFile(path.join(root, "src", window.page), "utf8");
    const capability = JSON.parse(await readFile(
      path.join(root, `src-tauri/capabilities/${window.capability}.json`),
      "utf8",
    ));
    assert.ok(capability.windows.includes(window.label));
    assert.match(rust, new RegExp(`\\"${window.label}\\"`));
  }
});
