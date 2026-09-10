import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("pre-publication Android status is honest and release links are base-path safe", async () => {
  const [index, setup, releaseState] = await Promise.all([
    source("website/src/pages/index.astro"),
    source("website/src/pages/setup.astro"),
    source("website/src/data/releases.js"),
  ]);
  assert.match(releaseState, /published: false/);
  assert.match(index, /No verified public APK is available yet/);
  assert.match(setup, /no verified public preview is available yet/i);
  assert.match(index, /href={`\$\{base\}\/setup\/#android-preview`}/);
  assert.doesNotMatch(index, /href=["'][^"']*\.apk/);
});

test("platform and accessible stock/enhanced capability content is present", async () => {
  const index = await source("website/src/pages/index.astro");
  assert.match(index, /Desktop/);
  assert.match(index, /Android preview/);
  assert.match(index, /iOS/);
  assert.match(index, /<caption/);
  assert.match(index, /scope="col"/);
  assert.match(index, /scope="row"/);
  assert.match(index, /Stock ZMK/);
  assert.match(index, /Enhanced firmware/);
  assert.match(index, /Remote layer control/);
});

test("Android setup and bounded troubleshooting cover the release contract", async () => {
  const [setup, faq] = await Promise.all([
    source("website/src/pages/setup.astro"),
    source("website/src/pages/faq.astro"),
  ]);
  for (const phrase of ["SHA-256", "unknown-app", "Nearby devices", "Pair", "Browse", "Live", "foreground-only", "arm64-v8a"]) {
    assert.match(setup, new RegExp(phrase, "i"));
  }
  for (const phrase of ["incorrect PIN", "capacity is exhausted", "Waiting for Live", "sequence-gap", "matching layout", "remote layer"]) {
    assert.match(faq, new RegExp(phrase, "i"));
  }
});
