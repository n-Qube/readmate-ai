import { describe, expect, it } from "vitest";
import { isPhoneOtpEnabled, parseAuthIdentifier } from "./otp-policy";

describe("mobile and web OTP policy", () => {
  it("offers phone codes for live and development Clerk builds", () => {
    expect(isPhoneOtpEnabled("pk_live_example")).toBe(true);
    expect(isPhoneOtpEnabled("pk_test_example")).toBe(true);
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

  it("rejects phone identifiers when phone codes are off, and junk input", () => {
    expect(parseAuthIdentifier("+233243671964", false)).toBeNull();
    expect(parseAuthIdentifier("12345")).toBeNull();
    expect(parseAuthIdentifier("not an email")).toBeNull();
  });
});
