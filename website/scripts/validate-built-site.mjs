import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(websiteRoot, "dist");
const basePath = "/keyboard_helper";

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(fullPath) : [fullPath];
  }));
  return nested.flat().filter((file) => file.endsWith(".html"));
}

function outputPathFor(pathname) {
  const relative = pathname.slice(basePath.length).replace(/^\//, "");
  if (!relative) return path.join(distRoot, "index.html");
  return pathname.endsWith("/")
    ? path.join(distRoot, relative, "index.html")
    : path.join(distRoot, relative);
}

for (const sourceFile of await htmlFiles(distRoot)) {
  const html = await readFile(sourceFile, "utf8");
  const references = [...html.matchAll(/(?:href|src)="([^"#?]+)(?:\?[^"#]*)?(?:#([^"?]*))?"/g)];

  for (const [, value, fragment] of references) {
    if (!value.startsWith(basePath)) continue;
    const target = outputPathFor(value);
    await access(target);

    if (fragment && target.endsWith(".html")) {
      const targetHtml = await readFile(target, "utf8");
      assert.match(targetHtml, new RegExp(`\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`), `${value}#${fragment}`);
    }
  }
}

console.log("Validated base-path routes, assets, and fragment targets.");
