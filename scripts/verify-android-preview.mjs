import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyAndroidPreviewApk } from "./android-preview-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const apkPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const version = option("--version");
const fingerprintFile = path.resolve(option("--fingerprint-file") ?? path.join(root, "android/preview-certificate.sha256"));

try {
  if (!apkPath || !version) throw new Error("Usage: verify-android-preview.mjs <apk> --version <x.y.z> [--fingerprint-file <path>]");
  const fingerprint = await readFile(fingerprintFile, "utf8");
  const evidence = await verifyAndroidPreviewApk(apkPath, { version, fingerprint });
  console.log(`Verified Android preview ${evidence.applicationId} ${evidence.versionName} (${evidence.versionCode}), ${evidence.archiveAbis.join(", ")}.`);
  console.log(`Signer SHA-256: ${evidence.signerFingerprint}`);
} catch (error) {
  console.error(`Android preview verification failed: ${error.message}`);
  process.exitCode = 1;
}

