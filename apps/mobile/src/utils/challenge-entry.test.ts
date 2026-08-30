import { describe, expect, it } from "vitest";
import { isWebMcpChallengeEntry } from "./challenge-entry";

describe("WebMCP challenge entry", () => {
  it("recognizes only the explicit challenge launch query", () => {
    expect(isWebMcpChallengeEntry("1")).toBe(true);
    expect(isWebMcpChallengeEntry(["other", "1"])).toBe(true);
    expect(isWebMcpChallengeEntry(undefined)).toBe(false);
    expect(isWebMcpChallengeEntry("0")).toBe(false);
    expect(isWebMcpChallengeEntry("true")).toBe(false);
  });
});
