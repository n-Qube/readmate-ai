import { describe, expect, it } from "vitest";
import { isPhoneOtpEnabled, parseAuthIdentifier } from "./otp-policy";

describe("mobile and web production OTP policy", () => {
  it("disables paid phone OTP for live Clerk builds", () => {
    expect(isPhoneOtpEnabled("pk_live_example")).toBe(false);
  });

  it("retains phone OTP for development keys", () => {
    expect(isPhoneOtpEnabled("pk_test_example")).toBe(true);
  });

  it("allows production email codes while rejecting phone identifiers", () => {
    expect(parseAuthIdentifier(" Judge@Example.com ", false)).toEqual({
      type: "email",
      value: "judge@example.com"
    });
    expect(parseAuthIdentifier("+233 24 123 4567", false)).toBeNull();
  });
});
