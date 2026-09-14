import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "tsconfig.check.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const options = config.compilerOptions ?? {};

for (const option of ["allowJs", "checkJs", "noEmit", "strict"]) {
  if (options[option] !== true) throw new Error(`tsconfig.check.json must keep ${option}: true.`);
}

if (!Array.isArray(config.files) || config.files.length === 0) {
  throw new Error("tsconfig.check.json must enumerate a non-empty checked file set.");
}

const allowedRoots = ["src/", "src-mobile/", "type-fixtures/"];
const forbiddenDirective = /@ts-(?:nocheck|ignore)\b/u;
for (const relativePath of config.files) {
  if (
    typeof relativePath !== "string"
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/u).includes("..")
    || !allowedRoots.some((root) => relativePath.startsWith(root))
  ) {
    throw new Error(`Invalid checked-scope path: ${String(relativePath)}`);
  }
  const source = await readFile(path.join(projectRoot, relativePath), "utf8");
  if (forbiddenDirective.test(source)) {
    throw new Error(`Broad TypeScript suppression is prohibited in ${relativePath}.`);
  }
}

console.log(`Verified TypeScript checked scope (${config.files.length} files).`);
