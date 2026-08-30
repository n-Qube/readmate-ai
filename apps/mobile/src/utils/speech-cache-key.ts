const CACHE_KEY_PREFIX_LENGTH = 48;

/**
 * Creates a filesystem-safe key without discarding the settings at the end of
 * the source key. The previous implementation simply truncated long keys,
 * which made English, Twi, Ewe, and Ga audio share the same cached file.
 */
export function speechCacheFileKey(sourceKey: string): string {
  const safePrefix = sourceKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, CACHE_KEY_PREFIX_LENGTH) || "speech";
  return `v2-${safePrefix}-${hashForward(sourceKey)}${hashBackward(sourceKey)}`;
}

function hashForward(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return unsignedHex(hash);
}

function hashBackward(value: string): string {
  let hash = 0x9e3779b9;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return unsignedHex(hash);
}

function unsignedHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
