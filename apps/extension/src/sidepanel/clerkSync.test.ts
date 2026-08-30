import { describe, expect, it } from "vitest";
import { getClerkSyncOptions } from "./clerkSync";

describe("getClerkSyncOptions", () => {
  it("enables Clerk sync only when cookies and host permissions are present", () => {
    expect(
      getClerkSyncOptions(
        {
          permissions: ["storage", "cookies"],
          host_permissions: ["https://*/*"]
        },
        "https://clever-sparrow-15.accounts.dev"
      )
    ).toEqual({
      syncHost: "https://clever-sparrow-15.accounts.dev",
      enableSyncHostListener: true
    });
  });

  it("disables Clerk sync when Chrome has not reloaded a manifest with cookies", () => {
    expect(
      getClerkSyncOptions(
        {
          permissions: ["storage"],
          host_permissions: ["https://*/*"]
        },
        "https://clever-sparrow-15.accounts.dev"
      )
    ).toEqual({ enableSyncHostListener: false });
  });
});
