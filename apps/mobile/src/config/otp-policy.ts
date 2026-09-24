export type OtpAuthMethod = "email" | "phone";

/** Sign-in is code-only: email or phone number, plus Google and Apple. */
export function isPhoneOtpEnabled(_publishableKey: string | undefined): boolean {
  return true;
}

export function parseAuthIdentifier(
  value: string,
  allowPhone = true
): { type: OtpAuthMethod; value: string } | null {
  const trimmed = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { type: "email", value: trimmed.toLowerCase() };
  }
  const phone = allowPhone ? normalizePhoneNumber(trimmed) : null;
  return phone ? { type: "phone", value: phone } : null;
}

function normalizePhoneNumber(value: string) {
  const normalized = value.replace(/[^\d+]/g, "");
  // Most ReadMate users are in Ghana, where numbers are written 0XX XXX XXXX.
  if (/^0\d{9}$/.test(normalized)) return `+233${normalized.slice(1)}`;
  if (!normalized.startsWith("+") || normalized.length < 8) return null;
  return normalized;
}
