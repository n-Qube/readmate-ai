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

/**
 * Clerk's developer-facing errors (for example when phone sign-in is not
 * enabled on the instance) are not meant for listeners; translate the ones
 * we can recognise and pass other messages through.
 */
export function friendlyOtpSendError(method: OtpAuthMethod, error: { code?: string; message?: string } | null): string {
  if (!error) return "Could not send a verification code.";
  const unsupportedPhone = error.code === "form_param_unknown" || /phone_number is not a valid parameter/i.test(error.message ?? "");
  if (method === "phone" && unsupportedPhone) return "Phone sign-in isn't available yet. Use your email, Google, or Apple instead.";
  return error.message || "Could not send a verification code.";
}
