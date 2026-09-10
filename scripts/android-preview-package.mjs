import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const ANDROID_APPLICATION_ID = "me.maxistar.keyboardhelper.companion";
export const ANDROID_DISPLAY_NAME = "Keyboard Helper Companion";
export const ANDROID_MIN_SDK = 24;
export const ANDROID_ABI = "arm64-v8a";

export function androidVersionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Android preview version must be plain semantic version x.y.z, got ${version}.`);
  const [, major, minor, patch] = match.map(Number);
  if (minor > 999 || patch > 999) throw new Error(`Android preview version components exceed Tauri version-code bounds: ${version}.`);
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function normalizeFingerprint(value) {
  const normalized = value.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(normalized)) {
    throw new Error("Expected signer fingerprint must contain exactly 32 SHA-256 bytes.");
  }
  return normalized;
}

function matchValue(output, pattern, label) {
  const match = pattern.exec(output);
  if (!match) throw new Error(`APK metadata is missing ${label}.`);
  return match[1];
}

export function parseAaptBadging(output) {
  const nativeLine = output.match(/^native-code:(.*)$/m)?.[1] ?? "";
  return {
    applicationId: matchValue(output, /^package:.* name='([^']+)'/m, "application ID"),
    versionCode: Number(matchValue(output, /^package:.* versionCode='([^']+)'/m, "version code")),
    versionName: matchValue(output, /^package:.* versionName='([^']+)'/m, "version name"),
    minSdk: Number(matchValue(output, /^sdkVersion:'([^']+)'/m, "minimum SDK")),
    displayName: matchValue(output, /^application-label:'([^']+)'/m, "application label"),
    nativeCodes: [...nativeLine.matchAll(/'([^']+)'/g)].map((match) => match[1]),
  };
}

export function parseSignerFingerprint(output) {
  const raw = matchValue(output, /Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]+)/i, "signer SHA-256 fingerprint");
  return normalizeFingerprint(raw);
}

export function nativeAbisFromEntries(entries) {
  return [...new Set(entries
    .split(/\r?\n/)
    .map((entry) => /^lib\/([^/]+)\/[^/]+$/.exec(entry)?.[1])
    .filter(Boolean))].sort();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual}.`);
}

export function verifyAndroidPreviewEvidence({ badging, signerOutput, zipEntries }, expected) {
  const metadata = parseAaptBadging(badging);
  const signerFingerprint = parseSignerFingerprint(signerOutput);
  const archiveAbis = nativeAbisFromEntries(zipEntries);
  const expectedVersionCode = androidVersionCode(expected.version);

  assertEqual(metadata.applicationId, ANDROID_APPLICATION_ID, "Application ID");
  assertEqual(metadata.displayName, ANDROID_DISPLAY_NAME, "Display name");
  assertEqual(metadata.versionName, expected.version, "Version name");
  assertEqual(metadata.versionCode, expectedVersionCode, "Version code");
  assertEqual(metadata.minSdk, ANDROID_MIN_SDK, "Minimum SDK");
  assertEqual(metadata.nativeCodes.join(","), ANDROID_ABI, "aapt native ABI scope");
  assertEqual(archiveAbis.join(","), ANDROID_ABI, "archive native ABI scope");
  assertEqual(signerFingerprint, normalizeFingerprint(expected.fingerprint), "Signer fingerprint");

  return { ...metadata, signerFingerprint, archiveAbis };
}

function runInspection(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const diagnostic = error.stderr?.toString().trim() || error.message;
    throw new Error(`${path.basename(command)} inspection failed: ${diagnostic}`, { cause: error });
  }
}

export async function verifyAndroidPreviewApk(apkPath, expected, commands = {}) {
  if (!apkPath.endsWith(".apk") || /(?:^|[-_.])debug(?:[-_.]|$)/i.test(path.basename(apkPath))) {
    throw new Error("Expected one release APK; debug or non-APK input is not publishable.");
  }
  const inspect = commands.run ?? runInspection;
  const evidence = {
    badging: inspect(commands.aapt ?? process.env.ANDROID_AAPT ?? "aapt", ["dump", "badging", apkPath]),
    signerOutput: inspect(commands.apksigner ?? process.env.ANDROID_APKSIGNER ?? "apksigner", ["verify", "--verbose", "--print-certs", apkPath]),
    zipEntries: inspect(commands.unzip ?? "unzip", ["-Z1", apkPath]),
  };
  return verifyAndroidPreviewEvidence(evidence, expected);
}

async function collectApks(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectApks(entryPath);
    return entry.isFile() && entry.name.endsWith(".apk") ? [entryPath] : [];
  }));
  return nested.flat();
}

export async function stageAndroidPreview({ inputDirectory, outputDirectory, version, fingerprint, verify = verifyAndroidPreviewApk }) {
  const apks = await collectApks(inputDirectory);
  if (apks.length !== 1) {
    throw new Error(`Expected exactly one APK under ${inputDirectory}, found ${apks.length}.`);
  }
  const source = apks[0];
  const evidence = await verify(source, { version, fingerprint });
  const artifactName = `Keyboard-Helper-Companion_${version}_android-arm64_preview.apk`;
  const artifactPath = path.join(outputDirectory, artifactName);
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(source, artifactPath);
  const bytes = await readFile(artifactPath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const checksumPath = `${artifactPath}.sha256`;
  await writeFile(checksumPath, `${checksum}  ${artifactName}\n`, "utf8");
  return { artifactPath, checksumPath, checksum, evidence };
}
