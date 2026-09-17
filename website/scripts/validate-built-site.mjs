import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(websiteRoot, "dist");
const basePath = "/keyboard_helper";

async function filesWithExtension(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesWithExtension(fullPath, extension) : [fullPath];
  }));
  return nested.flat().filter((file) => file.endsWith(extension));
}

function outputPathFor(pathname) {
  const relative = pathname.slice(basePath.length).replace(/^\//, "");
  if (!relative) return path.join(distRoot, "index.html");
  return pathname.endsWith("/")
    ? path.join(distRoot, relative, "index.html")
    : path.join(distRoot, relative);
}

for (const sourceFile of await filesWithExtension(distRoot, ".html")) {
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

const styleOutputFiles = [
  ...(await filesWithExtension(distRoot, ".html")),
  ...(await filesWithExtension(distRoot, ".css")),
];
const builtStyles = (await Promise.all(styleOutputFiles.map((file) => readFile(file, "utf8")))).join("\n");

assert.match(
  builtStyles,
  /(?:^|})a\{(?=[^}]*color:var\(--text\))(?=[^}]*text-decoration:underline)[^}]*}/,
  "shared content links use the light text token and remain underlined",
);
assert.match(builtStyles, /(?:^|})a:hover\{(?=[^}]*color:#fff)[^}]*}/, "shared content links expose a hover state");
assert.match(
  builtStyles,
  /(?:^|})a:focus-visible\{(?=[^}]*outline:3px solid var\(--accent\))[^}]*}/,
  "shared content links expose the accent focus treatment",
);

console.log("Validated base-path routes, assets, fragment targets, and shared content-link styles.");
