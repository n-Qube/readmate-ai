import { describe, expect, it } from "vitest";
import { isPhoneOtpEnabled, parseAuthIdentifier } from "./authIdentifier";

describe("extension production OTP policy", () => {
  it("disables paid phone OTP for live Clerk builds", () => {
    expect(isPhoneOtpEnabled("pk_live_example")).toBe(false);
  });

  it("retains phone OTP only for development and missing-key diagnostics", () => {
    expect(isPhoneOtpEnabled("pk_test_example")).toBe(true);
    expect(isPhoneOtpEnabled(undefined)).toBe(true);
  });

  it("accepts email but rejects phone identifiers when production phone OTP is disabled", () => {
    expect(parseAuthIdentifier(" Judge@Example.com ", false)).toEqual({
      type: "email",
      value: "judge@example.com"
    });
    expect(parseAuthIdentifier("+233 24 123 4567", false)).toBeNull();
  });

  it("normalizes a development phone identifier when phone OTP is enabled", () => {
    expect(parseAuthIdentifier("+233 24 123 4567", true)).toEqual({
      type: "phone",
      value: "+233241234567"
    });
  });
});
