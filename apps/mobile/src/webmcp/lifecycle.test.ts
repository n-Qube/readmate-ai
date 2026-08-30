import { describe, expect, it, vi } from "vitest";
import { createAbortableLifecycle, throwIfAborted } from "./lifecycle";

describe("WebMCP registration lifecycle", () => {
  it("aborts and clears agent state exactly once", () => {
    const clearAgentState = vi.fn();
    const lifecycle = createAbortableLifecycle(clearAgentState);

    lifecycle.dispose("principal changed");
    lifecycle.dispose("component unmounted");

    expect(lifecycle.disposed).toBe(true);
    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.signal.reason).toBe("principal changed");
    expect(clearAgentState).toHaveBeenCalledTimes(1);
    expect(() => throwIfAborted(lifecycle.signal)).toThrow();
  });
});

