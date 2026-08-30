import { describe, expect, it } from "vitest";
import { isUsableClerkPublishableKey } from "./clerk-publishable-key";

const validPayload = "ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk";

describe("isUsableClerkPublishableKey", () => {
  it("accepts structurally valid Clerk test and live keys", () => {
    expect(isUsableClerkPublishableKey(`pk_test_${validPayload}`)).toBe(true);
    expect(isUsableClerkPublishableKey(`pk_live_${validPayload}`)).toBe(true);
  });

  it("rejects the stale Metro cache value that crashed the device build", () => {
    expect(isUsableClerkPublishableKey("pk_live__fbBatchedBridgeConfig")).toBe(false);
  });

  it("rejects missing, truncated, and undecodable values", () => {
    expect(isUsableClerkPublishableKey("")).toBe(false);
    expect(isUsableClerkPublishableKey("pk_test_short")).toBe(false);
    expect(isUsableClerkPublishableKey("pk_test_not-a-clerk-payload-value")).toBe(false);
  });
});
