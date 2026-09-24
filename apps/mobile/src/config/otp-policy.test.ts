import { describe, expect, it } from "vitest";
import { friendlyOtpSendError, isPhoneOtpEnabled, parseAuthIdentifier } from "./otp-policy";

describe("mobile and web OTP policy", () => {
  it("offers phone codes only when the build switches them on", () => {
    expect(isPhoneOtpEnabled(undefined)).toBe(false);
    expect(isPhoneOtpEnabled("0")).toBe(false);
    expect(isPhoneOtpEnabled("1")).toBe(true);
  });

  it("normalizes email identifiers", () => {
    expect(parseAuthIdentifier(" Judge@Example.com ")).toEqual({ type: "email", value: "judge@example.com" });
  });

  it("accepts international phone numbers", () => {
    expect(parseAuthIdentifier("+233 24 367 1964")).toEqual({ type: "phone", value: "+233243671964" });
    expect(parseAuthIdentifier("+1 (555) 123-4567")).toEqual({ type: "phone", value: "+15551234567" });
  });

  it("treats a local Ghana number as +233", () => {
    expect(parseAuthIdentifier("024 367 1964")).toEqual({ type: "phone", value: "+233243671964" });
    expect(parseAuthIdentifier("0243671964")).toEqual({ type: "phone", value: "+233243671964" });
  });

  it("explains a Clerk instance without phone sign-in in plain words", () => {
    const raw = "phone_number is not a valid parameter for this request. Please ensure the appropriate settings are enabled in the Clerk Dashboard at https://dashboard.clerk.com/...";
    expect(friendlyOtpSendError("phone", { code: "form_param_unknown", message: raw })).toBe(
      "Phone sign-in isn't available yet. Use your email, Google, or Apple instead."
    );
    expect(friendlyOtpSendError("email", { code: "form_identifier_not_found", message: "Couldn't find your account." })).toBe("Couldn't find your account.");
    expect(friendlyOtpSendError("phone", null)).toBe("Could not send a verification code.");
  });

  it("rejects phone identifiers when phone codes are off, and junk input", () => {
    expect(parseAuthIdentifier("+233243671964", false)).toBeNull();
    expect(parseAuthIdentifier("12345")).toBeNull();
    expect(parseAuthIdentifier("not an email")).toBeNull();
  });
});
