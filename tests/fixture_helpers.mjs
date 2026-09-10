import { readFileSync } from "node:fs";

export function readFixture(relativePath) {
  const url = new URL(`fixtures/${relativePath}`, import.meta.url);
  return readFileSync(url, "utf8");
}

export function readJsonFixture(relativePath) {
  return JSON.parse(readFixture(relativePath));
}
