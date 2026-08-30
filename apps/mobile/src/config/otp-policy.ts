export type OtpAuthMethod = "email" | "phone";

export function isPhoneOtpEnabled(publishableKey: string | undefined): boolean {
  return !publishableKey?.startsWith("pk_live_");
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
  if (!normalized.startsWith("+") || normalized.length < 8) return null;
  return normalized;
}
