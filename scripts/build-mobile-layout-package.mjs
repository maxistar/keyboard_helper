import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.resolve(process.argv[2] ?? path.join(projectRoot, "dist", "examples", "corney-v1.khlayout"));
const entries = [
  ["manifest.json", Buffer.from(`${JSON.stringify({ format: "keyboard-helper-layout-package", version: 1, layout: "layout.json" }, null, 2)}\n`)],
  ["layout.json", await readFile(path.join(projectRoot, "src", "layout_corne.json"))],
  ...await Promise.all([
    "linux-logo-penguin.png",
    "apple_rainbow.png",
    "android-logo.png",
  ].map(async (name) => [`assets/images/${name}`, await readFile(path.join(projectRoot, "src", "assets", "images", name))])),
];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name, bytes) {
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x0021, 12);
  header.writeUInt32LE(crc32(bytes), 14);
  header.writeUInt32LE(bytes.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes]);
}

function centralHeader(name, bytes, offset) {
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x0021, 14);
  header.writeUInt32LE(crc32(bytes), 16);
  header.writeUInt32LE(bytes.length, 20);
  header.writeUInt32LE(bytes.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBytes]);
}

const localParts = [];
const centralParts = [];
let offset = 0;
for (const [name, bytes] of entries) {
  const local = localHeader(name, bytes);
  localParts.push(local, bytes);
  centralParts.push(centralHeader(name, bytes, offset));
  offset += local.length + bytes.length;
}
const central = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.concat([...localParts, central, end]));
process.stdout.write(`${outputPath}\n`);
