import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

test("TypeScript checking is strict, explicit, and no-emit", async () => {
  const config = await readJson("tsconfig.check.json");
  assert.equal(config.compilerOptions.allowJs, true);
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.strict, true);
  assert.ok(Array.isArray(config.files));
  assert.ok(config.files.length > 0);
  assert.equal(Object.hasOwn(config, "include"), false);

  for (const relativePath of config.files) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(source, /@ts-(?:nocheck|ignore)\b/u, relativePath);
  }
});

test("the JavaScript quality gate includes type checking", async () => {
  const packageJson = await readJson("package.json");
  assert.match(packageJson.scripts.typecheck, /verify-typescript-scope\.mjs/u);
  assert.match(packageJson.scripts.typecheck, /tsc --project tsconfig\.check\.json/u);
  assert.match(packageJson.scripts["check:js"], /npm run typecheck/u);
});

test("Tauri continues to load direct JavaScript source trees", async () => {
  const desktop = await readJson("src-tauri/tauri.conf.json");
  const android = await readJson("src-tauri/tauri.android.conf.json");
  assert.equal(desktop.build.frontendDist, "../src");
  assert.equal(android.build.frontendDist, "../src-mobile");
  assert.equal(Object.hasOwn(desktop.build, "beforeBuildCommand"), false);
  assert.equal(Object.hasOwn(android.build, "beforeBuildCommand"), false);
});
