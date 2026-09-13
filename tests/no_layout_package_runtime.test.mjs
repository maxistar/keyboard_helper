import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set(["node_modules", "dist", "target", "build", ".tauri", ".astro"]);
const sourceRoots = ["src", "src-mobile", "plugins/tauri-plugin-keyboard-helper-layouts", "scripts", "website/src"];
const textExtensions = new Set([".js", ".mjs", ".kt", ".rs", ".toml", ".json", ".md", ".astro"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(full));
    else if (entry.name !== "no_layout_package_runtime.test.mjs" && textExtensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

test("repository contains no active khlayout ZIP package runtime", async () => {
  const files = (await Promise.all(sourceRoots.map((entry) => collectFiles(path.join(root, entry))))).flat();
  const sources = await Promise.all(files.map(async (file) => [path.relative(root, file), await readFile(file, "utf8")]));
  const combined = sources.map(([file, source]) => `--- ${file}\n${source}`).join("\n");

  for (const pattern of [
    /build-mobile-layout-package/iu,
    /LayoutPackageSupport/iu,
    /keyboard-helper-layout-package/iu,
    /manifest\.json/iu,
    /Zip(?:InputStream|OutputStream|Entry|File)|java\.util\.zip/iu,
    /commit_package|discard_package|read_asset/iu,
    /commitPackage|discardPackage|readAsset/iu,
    /package migration|conversion guidance|convert and re-import/iu,
  ]) {
    assert.doesNotMatch(combined, pattern);
  }

  const khlayoutLines = combined.split("\n").filter((line) => line.includes(".khlayout"));
  assert.ok(khlayoutLines.length > 0, "unsupported diagnostic should remain discoverable");
  assert.ok(khlayoutLines.every((line) => /unsupported preview format|preview package format is no longer supported|does not parse \.khlayout archives/iu.test(line)), khlayoutLines.join("\n"));
});
