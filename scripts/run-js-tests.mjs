import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function collectTests(path) {
  const resolved = resolve(path);
  if (!statSync(resolved).isDirectory()) return [resolved];
  return readdirSync(resolved, { withFileTypes: true })
    .flatMap((entry) => {
      const child = resolve(resolved, entry.name);
      if (entry.isDirectory()) return collectTests(child);
      return entry.name.endsWith(".test.mjs") ? [child] : [];
    })
    .sort();
}

const requestedPaths = process.argv.slice(2);
const testFiles = (requestedPaths.length ? requestedPaths : ["tests"])
  .flatMap(collectTests);

if (testFiles.length === 0) {
  console.error("No JavaScript test files matched the requested paths.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
