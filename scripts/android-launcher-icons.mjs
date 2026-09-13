import { deflateSync } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = path.join(projectRoot, "android/icons/companion-launcher.svg");
const defaultAndroidRoot = path.join(projectRoot, "src-tauri/gen/android");
const densities = new Map([
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
]);

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

export function parseIconSource(source) {
  const svg = source.match(/<svg\b([^>]*)>/)?.[1];
  if (!svg) throw new Error("Launcher icon source must contain one SVG root.");
  const viewBox = attributes(svg).viewBox?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error("Launcher icon source must declare a numeric viewBox.");
  }
  const rects = [...source.matchAll(/<rect\b([^>]*)\/>/g)].map((match) => attributes(match[1]));
  const background = rects.find((rect) => rect["data-role"] === "background");
  const keys = rects.filter((rect) => rect["data-key"]).map((rect) => ({
    id: rect["data-key"],
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
    radius: Number(rect.rx),
    color: rect.fill,
  }));
  if (!background?.fill || keys.length !== 6) {
    throw new Error("Launcher icon source must contain one background and exactly six key rectangles.");
  }
  if (keys.some((key) => [key.x, key.y, key.width, key.height, key.radius].some((value) => !Number.isFinite(value)))) {
    throw new Error("Launcher key geometry must be numeric.");
  }
  return { viewBox, background: background.fill, keys };
}

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function roundedPath({ x, y, width, height, radius }) {
  const right = x + width;
  const bottom = y + height;
  return `M${x + radius},${y} H${right - radius} A${radius},${radius} 0 0,1 ${right},${y + radius} V${bottom - radius} A${radius},${radius} 0 0,1 ${right - radius},${bottom} H${x + radius} A${radius},${radius} 0 0,1 ${x},${bottom - radius} V${y + radius} A${radius},${radius} 0 0,1 ${x + radius},${y} Z`;
}

function foregroundVector(icon, monochrome = false) {
  const grouped = new Map();
  for (const key of icon.keys) grouped.set(key.color, [...(grouped.get(key.color) ?? []), key]);
  const paths = monochrome
    ? [{ color: "#FFFFFFFF", keys: icon.keys }]
    : [...grouped].map(([color, keys]) => ({ color, keys }));
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
${paths.map(({ color, keys }) => `    <path
        android:fillColor="${xmlEscape(color)}"
        android:pathData="${keys.map(roundedPath).join(" ")}" />`).join("\n")}
</vector>
`;
}

function backgroundVector(color) {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="${xmlEscape(color)}" android:pathData="M0,0 H108 V108 H0 Z" />
</vector>
`;
}

function adaptiveIcon(includeMonochrome) {
  return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
${includeMonochrome ? "    <monochrome android:drawable=\"@drawable/ic_launcher_monochrome\" />\n" : ""}</adaptive-icon>
`;
}

function parseColor(color) {
  const value = color.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`Unsupported launcher color: ${color}`);
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16), 255];
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  if (x < left || y < top || x >= left + width || y >= top + height) return false;
  const nearestX = Math.max(left + radius, Math.min(x, left + width - radius));
  const nearestY = Math.max(top + radius, Math.min(y, top + height - radius));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

function insideCircle(x, y, center, radius) {
  return (x - center) ** 2 + (y - center) ** 2 <= radius ** 2;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

export function renderLegacyPng(icon, size, round = false) {
  const samples = 4;
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const background = parseColor(icon.background);
  const keys = icon.keys.map((key) => ({ ...key, rgba: parseColor(key.color) }));
  const scale = size / 108;
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const sourceX = px / scale;
          const sourceY = py / scale;
          const key = keys.find((candidate) => insideRoundedRect(
            sourceX,
            sourceY,
            candidate.x,
            candidate.y,
            candidate.width,
            candidate.height,
            candidate.radius,
          ));
          const onBackground = round
            ? insideCircle(px, py, size / 2, size / 2 - 1)
            : insideRoundedRect(px, py, 1, 1, size - 2, size - 2, size * 0.2);
          const rgba = key && onBackground ? key.rgba : onBackground ? background : [0, 0, 0, 0];
          for (let channel = 0; channel < 4; channel += 1) sum[channel] += rgba[channel];
        }
      }
      const offset = rowOffset + 1 + x * 4;
      for (let channel = 0; channel < 4; channel += 1) rows[offset + channel] = Math.round(sum[channel] / samples ** 2);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function writeResource(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

export function configureManifest(source) {
  const icon = 'android:icon="@mipmap/ic_launcher"';
  const round = 'android:roundIcon="@mipmap/ic_launcher_round"';
  if (count(source, icon) !== 1) {
    throw new Error(`Expected exactly one Android launcher icon anchor, found ${count(source, icon)}.`);
  }
  if (count(source, round) > 1) throw new Error("Expected at most one Android round icon declaration.");
  return count(source, round) === 1 ? source : source.replace(icon, `${icon}\n        ${round}`);
}

export async function syncAndroidLauncherIcons({ androidRoot = defaultAndroidRoot, sourcePath = defaultSource } = {}) {
  const manifestPath = path.join(androidRoot, "app/src/main/AndroidManifest.xml");
  let manifest;
  try {
    manifest = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Generated Android project is unavailable at ${manifestPath}. Run npm run android:init first.`, { cause: error });
  }
  const icon = parseIconSource(await readFile(sourcePath, "utf8"));
  const resourceRoot = path.join(androidRoot, "app/src/main/res");
  await writeResource(path.join(resourceRoot, "drawable/ic_launcher_background.xml"), backgroundVector(icon.background));
  await writeResource(path.join(resourceRoot, "drawable/ic_launcher_foreground.xml"), foregroundVector(icon));
  await writeResource(path.join(resourceRoot, "drawable/ic_launcher_monochrome.xml"), foregroundVector(icon, true));
  await rm(path.join(resourceRoot, "drawable-v24/ic_launcher_foreground.xml"), { force: true });
  for (const api of ["mipmap-anydpi-v26", "mipmap-anydpi-v33"]) {
    for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
      await writeResource(path.join(resourceRoot, api, name), adaptiveIcon(api.endsWith("v33")));
    }
  }
  for (const [density, size] of densities) {
    const directory = path.join(resourceRoot, `mipmap-${density}`);
    await writeResource(path.join(directory, "ic_launcher.png"), renderLegacyPng(icon, size));
    await writeResource(path.join(directory, "ic_launcher_round.png"), renderLegacyPng(icon, size, true));
    await rm(path.join(directory, "ic_launcher_foreground.png"), { force: true });
  }
  await writeFile(manifestPath, configureManifest(manifest), "utf8");
  return { sourcePath, manifestPath, densities: Object.fromEntries(densities) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await syncAndroidLauncherIcons();
  console.log(`Synchronized six-key Android launcher resources from ${path.relative(projectRoot, result.sourcePath)}.`);
}
