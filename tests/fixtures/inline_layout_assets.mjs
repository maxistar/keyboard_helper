export const ONE_BY_ONE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
export const ONE_BY_ONE_JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/As//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/ISf/2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAARD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAARD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QH//Z";
export const ONE_BY_ONE_WEBP_BASE64 = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuU";

export function textLayout(overrides = {}) {
  return {
    name: "Inline Fixture",
    keySize: { w: 50, h: 50, gap: 4 },
    keyPositions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    keyLayers: { default: [["A", "KeyA"], ["B", "KeyB"]] },
    ...overrides,
  };
}

export function inlineImageLayout({ id = "logo", mimeType = "image/png", data = ONE_BY_ONE_PNG_BASE64, reference = null, extraAssets = {}, overrides = {} } = {}) {
  const assetReference = reference ?? `asset:${id}`;
  return textLayout({
    format: "keyboard-helper-layout",
    version: 1,
    embeddedAssets: {
      [id]: { mimeType, encoding: "base64", data },
      ...extraAssets,
    },
    keyLayers: { default: [["Logo", "", assetReference], ["B", "KeyB"]] },
    ...overrides,
  });
}
