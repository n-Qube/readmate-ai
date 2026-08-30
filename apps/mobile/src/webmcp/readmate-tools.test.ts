import { describe, expect, it, vi } from "vitest";
import { beginReadMateToolRegistration } from "./readmate-tools";

describe("native WebMCP adapter", () => {
  it("never registers browser tools and still clears lifecycle state", async () => {
    const clearAgentState = vi.fn();
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken: async () => "token",
      handlers: {
        searchLibrary: vi.fn(),
        getDocumentContext: vi.fn(),
        prepareListening: vi.fn()
      },
      clearAgentState
    });

    expect(registration.supported).toBe(false);
    await expect(registration.ready).resolves.toMatchObject({ reason: "unsupported", registeredTools: [] });
    registration.dispose();
    expect(registration.signal.aborted).toBe(true);
    expect(clearAgentState).toHaveBeenCalledTimes(1);
  });
});

