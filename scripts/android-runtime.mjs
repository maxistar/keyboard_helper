import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const companionPackage = "me.maxistar.keyboardhelper.companion";
const defaultSource = path.join(projectRoot, "android/runtime/MainActivity.kt");
const defaultAndroidRoot = path.join(projectRoot, "src-tauri/gen/android");
const relativeActivityPath = "app/src/main/java/me/maxistar/keyboardhelper/companion/MainActivity.kt";

export function validateActivitySource(source) {
  const required = [
    `package ${companionPackage}`,
    "class MainActivity : TauriActivity()",
    "enableEdgeToEdge()",
    "WindowInsetsCompat.Type.systemBars()",
    "WindowInsetsCompat.Type.displayCutout()",
    "ViewCompat.setOnApplyWindowInsetsListener",
    "ViewCompat.requestApplyInsets",
  ];
  for (const value of required) {
    if (!source.includes(value)) throw new Error(`Android runtime template is missing required contract: ${value}`);
  }
  return source;
}

function validateGradleIdentity(source) {
  const expectedNamespace = `namespace = "${companionPackage}"`;
  const expectedApplicationId = `applicationId = "${companionPackage}"`;
  if (!source.includes(expectedNamespace) || !source.includes(expectedApplicationId)) {
    throw new Error(`Generated Android project does not use the expected companion package ${companionPackage}.`);
  }
}

export async function syncAndroidRuntime({ androidRoot = defaultAndroidRoot, sourcePath = defaultSource } = {}) {
  const gradlePath = path.join(androidRoot, "app/build.gradle.kts");
  let gradle;
  try {
    gradle = await readFile(gradlePath, "utf8");
  } catch (error) {
    throw new Error(`Generated Android project is unavailable at ${gradlePath}. Run npm run android:init first.`, { cause: error });
  }
  validateGradleIdentity(gradle);
  const source = validateActivitySource(await readFile(sourcePath, "utf8"));
  const activityPath = path.join(androidRoot, relativeActivityPath);
  await mkdir(path.dirname(activityPath), { recursive: true });
  await writeFile(activityPath, source, "utf8");
  return { sourcePath, activityPath, packageName: companionPackage };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await syncAndroidRuntime();
  console.log(`Synchronized Android runtime activity from ${path.relative(projectRoot, result.sourcePath)}.`);
}
