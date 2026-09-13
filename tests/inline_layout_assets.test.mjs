import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  canonicalLayoutDigest,
  CUSTOM_LAYOUT_MAX_BYTES,
  validateImportedLayout,
} from "../src-mobile/custom_layouts.js";
import {
  INLINE_LAYOUT_LIMITS,
  validateLayoutDefinition,
} from "../src/layout_semantics.js";
import { verifyInlineAssetDecoding } from "../src/inline_asset_presentation.js";
import {
  inlineImageLayout,
  ONE_BY_ONE_JPEG_BASE64,
  ONE_BY_ONE_PNG_BASE64,
  ONE_BY_ONE_WEBP_BASE64,
  textLayout,
} from "./fixtures/inline_layout_assets.mjs";

function validateLayout(value) {
  return validateImportedLayout(JSON.stringify(value));
}

test("inline layout fixtures accept legacy text JSON and version-one image JSON", () => {
  assert.equal(validateLayout(textLayout()).valid, true);
  assert.equal(validateLayout(inlineImageLayout()).valid, true);
  assert.equal(validateLayout(inlineImageLayout({ mimeType: "image/jpeg", data: ONE_BY_ONE_JPEG_BASE64 })).valid, true);
  assert.equal(validateLayout(inlineImageLayout({ mimeType: "image/webp", data: ONE_BY_ONE_WEBP_BASE64 })).valid, true);
});

test("inline layout contract rejects unsupported format and incomplete references", () => {
  assert.equal(validateLayout({ ...inlineImageLayout(), format: undefined }).code, "invalid-layout");
  assert.equal(validateLayout({ ...inlineImageLayout(), version: 2 }).code, "invalid-layout");
  assert.equal(validateLayout(inlineImageLayout({ id: "bad id" })).code, "invalid-layout");
  assert.equal(validateLayout(inlineImageLayout({ reference: "asset:missing" })).code, "invalid-layout");
  assert.equal(validateLayout(inlineImageLayout({ extraAssets: { unused: { mimeType: "image/png", encoding: "base64", data: ONE_BY_ONE_PNG_BASE64 } } })).code, "invalid-layout");
});

test("inline layout contract rejects external image sources", () => {
  for (const reference of ["assets/images/key.png", "https://example.test/key.png", "data:image/png;base64,AA==", "file:///tmp/key.png", "content://provider/key.png", "../key.png"]) {
    assert.equal(validateLayout(inlineImageLayout({ reference })).code, "invalid-layout", reference);
  }
});

test("inline assets reject malformed, mismatched, animated, and oversized content", () => {
  assert.equal(validateLayout(inlineImageLayout({ data: "not base64" })).code, "invalid-layout");
  assert.equal(validateLayout(inlineImageLayout({ mimeType: "image/svg+xml" })).code, "invalid-layout");
  assert.equal(validateLayout(inlineImageLayout({ mimeType: "image/jpeg", data: ONE_BY_ONE_PNG_BASE64 })).code, "invalid-layout");

  const animatedWebpHeader = "UklGRhQAAABXRUJQVlA4WAoAAAACAAAAAAA=";
  assert.equal(validateLayout(inlineImageLayout({ mimeType: "image/webp", data: animatedWebpHeader })).code, "invalid-layout");

  const tooManyAssets = Object.fromEntries(Array.from({ length: INLINE_LAYOUT_LIMITS.assets + 1 }, (_, index) => [
    `a${index}`,
    { mimeType: "image/png", encoding: "base64", data: ONE_BY_ONE_PNG_BASE64 },
  ]));
  assert.equal(validateLayout(textLayout({
    format: "keyboard-helper-layout",
    version: 1,
    embeddedAssets: tooManyAssets,
    keyLayers: { default: [["A", "", "asset:a0"], ["B", "KeyB"]] },
  })).code, "invalid-layout");

  assert.equal(validateImportedLayout(" ".repeat(CUSTOM_LAYOUT_MAX_BYTES + 1)).code, "document-too-large");
});

test("canonical digest ignores formatting but keeps asset identifiers semantic", async () => {
  const compact = inlineImageLayout();
  const reordered = {
    keyLayers: compact.keyLayers,
    embeddedAssets: { logo: { data: ONE_BY_ONE_PNG_BASE64.replace(/(.{8})/gu, "$1\n"), encoding: "base64", mimeType: "image/png" } },
    keyPositions: compact.keyPositions,
    version: 1,
    keySize: { h: 50, gap: 4, w: 50 },
    format: "keyboard-helper-layout",
    name: compact.name,
  };
  assert.equal(
    await canonicalLayoutDigest(validateLayout(compact), webcrypto),
    await canonicalLayoutDigest(validateImportedLayout(JSON.stringify(reordered, null, 2)), webcrypto),
  );

  const renamed = inlineImageLayout({ id: "os-logo" });
  assert.notEqual(
    await canonicalLayoutDigest(validateLayout(compact), webcrypto),
    await canonicalLayoutDigest(validateLayout(renamed), webcrypto),
  );
});

test("shared semantic validator returns inline asset inventory for accepted documents", () => {
  const validation = validateLayoutDefinition(inlineImageLayout());
  assert.equal(validation.valid, true);
  assert.equal(validation.inlineAssets.assets.get("logo").mimeType, "image/png");
  assert.equal(validation.inlineAssets.assets.get("logo").width, 1);
  assert.equal(validation.inlineAssets.assets.get("logo").height, 1);
});

test("raw parser rejects duplicate keys and corrupted PNG chunks", () => {
  const duplicate = JSON.stringify(inlineImageLayout()).replace('"logo":{', '"logo":null,"logo":{');
  assert.equal(validateImportedLayout(duplicate).code, "invalid-json");

  const bytes = Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64");
  bytes[bytes.length - 8] ^= 1;
  assert.equal(validateLayout(inlineImageLayout({ data: bytes.toString("base64") })).code, "invalid-layout");
  assert.equal(validateLayout(inlineImageLayout({
    mimeType: "image/jpeg",
    data: Buffer.from(ONE_BY_ONE_JPEG_BASE64, "base64").subarray(0, -2).toString("base64"),
  })).code, "invalid-layout");
  assert.equal(validateLayout(inlineImageLayout({
    mimeType: "image/webp",
    data: Buffer.from(ONE_BY_ONE_WEBP_BASE64, "base64").subarray(0, -1).toString("base64"),
  })).code, "invalid-layout");
});

test("canonical digest normalizes equivalent array and object key entries", async () => {
  const arrayForm = inlineImageLayout();
  const objectForm = structuredClone(arrayForm);
  objectForm.keyLayers.default[0] = { text: "Logo", code: "", image: "asset:logo" };
  assert.equal(
    await canonicalLayoutDigest(validateLayout(arrayForm), webcrypto),
    await canonicalLayoutDigest(validateLayout(objectForm), webcrypto),
  );
});

test("complete bitmap decoding rejects payloads the browser cannot decode", async () => {
  const validation = validateLayoutDefinition(inlineImageLayout());
  await assert.rejects(
    verifyInlineAssetDecoding(validation, {
      createImageBitmapApi: async () => { throw new Error("decode failed"); },
      BlobConstructor: Blob,
    }),
    /could not be decoded completely/,
  );
});
