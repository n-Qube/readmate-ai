import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVE_AGENT_PATHNAMES, isAgentActionPathEnabled } from "./route-gate";

describe("WebMCP sensitive route gate", () => {
  it.each(DEFAULT_SENSITIVE_AGENT_PATHNAMES)("disables tools on %s and nested routes", (pathname) => {
    expect(isAgentActionPathEnabled(pathname)).toBe(false);
    expect(isAgentActionPathEnabled(`${pathname}/manage`)).toBe(false);
  });

  it("keeps normal reading routes eligible", () => {
    expect(isAgentActionPathEnabled("/" )).toBe(true);
    expect(isAgentActionPathEnabled("/document/doc-1?mode=summary")).toBe(true);
    expect(isAgentActionPathEnabled("/player")).toBe(true);
  });

  it("allows product code to disable every route explicitly", () => {
    expect(isAgentActionPathEnabled("/library", false)).toBe(false);
  });
});
