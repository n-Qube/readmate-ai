import { describe, expect, it, vi } from "vitest";
import { getWebMcpModelContext, isWebMcpAvailable } from "./feature-detection";

describe("WebMCP feature detection", () => {
  it("is a harmless no-op when the browser API is absent", () => {
    expect(getWebMcpModelContext({})).toBeNull();
    expect(isWebMcpAvailable({})).toBe(false);
  });

  it("detects document.modelContext without using a navigator fallback", () => {
    const modelContext = { registerTool: vi.fn() } as unknown as ReadMateWebMcpModelContext;
    expect(getWebMcpModelContext({ modelContext })).toBe(modelContext);
    expect(isWebMcpAvailable({ modelContext })).toBe(true);
  });
});

