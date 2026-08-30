import { describe, expect, it } from "vitest";
import { CHROME_ERROR_URL, CLERK_COMPLETION_PLACEHOLDER_URL, isAuthCompletionTab, isAuthCompletionUrl, isHostedAccountCompletionTab } from "./authPopup";

describe("auth popup completion detection", () => {
  it("detects Clerk's Chrome extension completion placeholder", () => {
    expect(isAuthCompletionUrl(CLERK_COMPLETION_PLACEHOLDER_URL)).toBe(true);
    expect(isAuthCompletionTab({ url: CLERK_COMPLETION_PLACEHOLDER_URL })).toBe(true);
  });

  it("detects Chrome error tabs that still identify the Clerk completion placeholder", () => {
    expect(isAuthCompletionTab({
      url: CHROME_ERROR_URL,
      title: CLERK_COMPLETION_PLACEHOLDER_URL
    })).toBe(true);
  });

  it("does not treat unrelated Chrome error pages as completed auth popups", () => {
    expect(isAuthCompletionTab({
      url: CHROME_ERROR_URL,
      title: "example.test is blocked"
    })).toBe(false);
  });

  it("detects a completed hosted account sign-in on the exact ReadMate origin", () => {
    expect(isHostedAccountCompletionTab(
      { url: "https://accounts.readmate.n-qube.com/user" },
      "https://accounts.readmate.n-qube.com"
    )).toBe(true);
  });

  it("rejects lookalike hosted account origins and sign-in pages", () => {
    expect(isHostedAccountCompletionTab(
      { url: "https://accounts.readmate.n-qube.com.evil.test/user" },
      "https://accounts.readmate.n-qube.com"
    )).toBe(false);
    expect(isHostedAccountCompletionTab(
      { url: "https://accounts.readmate.n-qube.com/sign-in" },
      "https://accounts.readmate.n-qube.com"
    )).toBe(false);
  });
});
