export function isUsableClerkPublishableKey(value: string): boolean {
  const match = /^(pk_(?:test|live)_)([A-Za-z0-9_-]+)$/.exec(value);
  if (!match || match[2].length < 20) return false;

  try {
    return decodeBase64Url(match[2]).endsWith("$");
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  let bits = 0;
  let bitCount = 0;
  let decoded = "";

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base64url character");
    bits = (bits << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      decoded += String.fromCharCode((bits >> bitCount) & 0xff);
    }
  }

  return decoded;
}
