import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseLayoutJson, validateLayoutDefinition } from "../src/layout_semantics.js";

const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function usage() {
  console.error([
    "Usage:",
    "  node scripts/embed-inline-layout-assets.mjs <input-layout.json> <output-layout.json> <image-path>=<asset-id> [... ]",
    "",
    "Example:",
    "  node scripts/embed-inline-layout-assets.mjs src/layout_corne.json /tmp/corne-inline.json \\",
    "    assets/images/apple_rainbow.png=apple-rainbow assets/images/android-logo.png=android-logo",
    "",
    "The utility does not parse .khlayout archives or resize images; provide already-bounded bitmap files.",
  ].join("\n"));
}

function replaceReferences(value, replacements) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry === "string" && replacements.has(entry)) value[index] = replacements.get(entry);
      else replaceReferences(entry, replacements);
    });
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && replacements.has(entry)) value[key] = replacements.get(entry);
    else replaceReferences(entry, replacements);
  }
}

const [inputPath, outputPath, ...assetArgs] = process.argv.slice(2);
if (!inputPath || !outputPath || assetArgs.length === 0) {
  usage();
  process.exit(1);
}

const layout = parseLayoutJson(await readFile(inputPath, "utf8"));
const embeddedAssets = { ...(layout.embeddedAssets ?? {}) };
const replacements = new Map();

for (const arg of assetArgs) {
  const separator = arg.lastIndexOf("=");
  if (separator <= 0 || separator === arg.length - 1) throw new Error(`Invalid asset argument: ${arg}`);
  const imageReference = arg.slice(0, separator);
  const id = arg.slice(separator + 1);
  if (Object.hasOwn(embeddedAssets, id)) throw new Error(`Duplicate asset identifier: ${id}`);
  const mimeType = MIME_BY_EXTENSION.get(path.extname(imageReference).toLocaleLowerCase("en-US"));
  if (!mimeType) throw new Error(`Unsupported bitmap extension: ${imageReference}`);
  const sourcePath = path.resolve(path.dirname(inputPath), imageReference);
  embeddedAssets[id] = {
    mimeType,
    encoding: "base64",
    data: await readFile(sourcePath, "base64"),
  };
  replacements.set(imageReference, `asset:${id}`);
}

layout.format = "keyboard-helper-layout";
layout.version = 1;
layout.embeddedAssets = embeddedAssets;
replaceReferences(layout.keyLayers, replacements);

const validation = validateLayoutDefinition(layout);
if (!validation.valid) throw new Error(validation.error);

await writeFile(outputPath, `${JSON.stringify(layout, null, 2)}\n`);
console.log(`Wrote ${outputPath} with ${Object.keys(embeddedAssets).length} embedded asset(s).`);
