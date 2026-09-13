const ownProperty = Object.prototype.hasOwnProperty;

export function hasOwn(value, key) {
  return ownProperty.call(value, key);
}

function uuidFromBytes(bytes) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function createRandomUuid(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new TypeError("A cryptographic random source is required to create a layout identity.");
  }
  return uuidFromBytes(cryptoApi.getRandomValues(new Uint8Array(16)));
}
