import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("future contract fixture areas remain explicitly reserved", async () => {
  const notes = await readFile(path.join(root, "tests/fixtures/future/README.md"), "utf8");
  for (const area of ["analytics", "lessons", "mobile", "BLE[- ]events"]) {
    assert.match(notes, new RegExp(area, "i"));
  }
});
