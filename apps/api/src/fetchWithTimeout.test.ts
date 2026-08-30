import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

describe("fetchWithTimeout", () => {
  it("passes an active deadline signal to outbound requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));

    await fetchWithTimeout("https://provider.example", {}, { timeoutMs: 5_000, fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "https://provider.example",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });

  it("preserves caller cancellation while adding a deadline", async () => {
    const caller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));

    await fetchWithTimeout("https://provider.example", { signal: caller.signal }, { fetcher });
    const combined = fetcher.mock.calls[0]?.[1]?.signal;
    caller.abort();

    expect(combined?.aborted).toBe(true);
  });
});
