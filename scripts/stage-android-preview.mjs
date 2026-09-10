import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stageAndroidPreview } from "./android-preview-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

try {
  const inputDirectory = option("--input");
  const outputDirectory = option("--output");
  const version = option("--version");
  if (!inputDirectory || !outputDirectory || !version) {
    throw new Error("Usage: stage-android-preview.mjs --input <apk-dir> --output <stage-dir> --version <x.y.z> [--fingerprint-file <path>]");
  }
  const fingerprintFile = path.resolve(option("--fingerprint-file") ?? path.join(root, "android/preview-certificate.sha256"));
  const fingerprint = await readFile(fingerprintFile, "utf8");
  const result = await stageAndroidPreview({
    inputDirectory: path.resolve(inputDirectory),
    outputDirectory: path.resolve(outputDirectory),
    version,
    fingerprint,
  });
  console.log(`Staged ${path.basename(result.artifactPath)} and ${path.basename(result.checksumPath)}.`);
} catch (error) {
  console.error(`Android preview staging failed: ${error.message}`);
  process.exitCode = 1;
}

