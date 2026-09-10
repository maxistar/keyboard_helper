import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultGradlePath = path.join(root, "src-tauri/gen/android/app/build.gradle.kts");
const signingConfigPath = path.join(root, "android/signing/signing-config.gradle.kts");
const releaseBuildTypePath = path.join(root, "android/signing/release-build-type.gradle.kts");

const signingConfigAnchor = "    buildTypes {\n";
const releaseBuildTypeAnchor = "        getByName(\"release\") {\n";
const markers = [
  "KEYBOARD_HELPER_ANDROID_SIGNING_CONFIG_START",
  "KEYBOARD_HELPER_ANDROID_SIGNING_CONFIG_END",
  "KEYBOARD_HELPER_ANDROID_RELEASE_SIGNING_START",
  "KEYBOARD_HELPER_ANDROID_RELEASE_SIGNING_END",
];

function occurrenceCount(source, value) {
  return source.split(value).length - 1;
}

function requireSingleAnchor(source, anchor, description) {
  const count = occurrenceCount(source, anchor);
  if (count !== 1) {
    throw new Error(`Expected exactly one ${description} anchor, found ${count}. Generated Android template may have changed.`);
  }
}

export function configureAndroidSigning(source, signingConfigFragment, releaseBuildTypeFragment) {
  const markerCounts = markers.map((marker) => occurrenceCount(source, marker));
  const hasAnyMarker = markerCounts.some((count) => count > 0);
  const hasOneOfEveryMarker = markerCounts.every((count) => count === 1);

  if (hasAnyMarker) {
    if (!hasOneOfEveryMarker) {
      throw new Error("Android signing overlay is partial or duplicated; regenerate Android state before retrying.");
    }
    if (!source.includes(signingConfigFragment.trimEnd()) || !source.includes(releaseBuildTypeFragment.trimEnd())) {
      throw new Error("Android signing overlay markers exist but the configured fragments differ from the project-owned templates.");
    }
    return { content: source, changed: false };
  }

  requireSingleAnchor(source, signingConfigAnchor, "buildTypes");
  requireSingleAnchor(source, releaseBuildTypeAnchor, "release build type");

  const withSigningConfig = source.replace(
    signingConfigAnchor,
    `${signingConfigFragment}${signingConfigAnchor}`,
  );
  const configured = withSigningConfig.replace(
    releaseBuildTypeAnchor,
    `${releaseBuildTypeAnchor}${releaseBuildTypeFragment}`,
  );

  return { content: configured, changed: true };
}

export async function configureAndroidSigningFile(gradlePath = defaultGradlePath) {
  const [source, signingConfigFragment, releaseBuildTypeFragment] = await Promise.all([
    readFile(gradlePath, "utf8"),
    readFile(signingConfigPath, "utf8"),
    readFile(releaseBuildTypePath, "utf8"),
  ]);
  const result = configureAndroidSigning(source, signingConfigFragment, releaseBuildTypeFragment);
  if (result.changed) await writeFile(gradlePath, result.content, "utf8");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const gradlePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultGradlePath;
  try {
    const result = await configureAndroidSigningFile(gradlePath);
    console.log(result.changed ? "Configured Android release signing." : "Android release signing is already configured.");
  } catch (error) {
    console.error(`Unable to configure Android release signing: ${error.message}`);
    process.exitCode = 1;
  }
}
