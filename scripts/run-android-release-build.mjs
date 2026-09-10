import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoManifest = path.join(root, "src-tauri/Cargo.toml");

export async function runWithRestoredFile(filePath, operation) {
  const original = await readFile(filePath, "utf8");
  try {
    return await operation();
  } finally {
    const current = await readFile(filePath, "utf8");
    if (current !== original) await writeFile(filePath, original, "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runWithRestoredFile(cargoManifest, () => spawnSync(
    "tauri",
    ["android", "build", "--target", "aarch64", "--apk", "true", "--aab", "false", "--ci"],
    { cwd: root, env: process.env, stdio: "inherit" },
  ));
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

