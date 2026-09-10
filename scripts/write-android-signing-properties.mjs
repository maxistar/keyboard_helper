import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputPath = path.join(root, "src-tauri/gen/android/keystore.properties");

export function escapeJavaPropertyValue(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("=", "\\=")
    .replaceAll(":", "\\:")
    .replaceAll("#", "\\#")
    .replaceAll("!", "\\!")
    .replace(/^ +/, (spaces) => "\\ ".repeat(spaces.length));
}

export async function writeAndroidSigningProperties(outputPath = defaultOutputPath, environment = process.env) {
  const values = {
    storeFile: environment.ANDROID_KEYSTORE_FILE,
    storePassword: environment.ANDROID_KEYSTORE_PASSWORD,
    keyAlias: environment.ANDROID_KEY_ALIAS,
    keyPassword: environment.ANDROID_KEY_PASSWORD,
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing Android signing inputs: ${missing.join(", ")}.`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  const content = Object.entries(values)
    .map(([name, value]) => `${name}=${escapeJavaPropertyValue(value)}`)
    .join("\n");
  await writeFile(outputPath, `${content}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await writeAndroidSigningProperties();
    console.log("Created ephemeral Android signing properties.");
  } catch (error) {
    console.error(`Unable to create Android signing properties: ${error.message}`);
    process.exitCode = 1;
  }
}
