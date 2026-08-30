import { describe, expect, it, vi } from "vitest";
import { safeRemoteFetch } from "./safeRemoteFetch.js";

const publicLookup = async () => ["93.184.216.34"];

describe("safeRemoteFetch", () => {
  it.each([
    "http://127.0.0.1/internal",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/internal",
    "http://[::1]/internal",
    "http://[fd00::1]/internal"
  ])("rejects blocked literal destination %s before fetching", async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(safeRemoteFetch(url, { fetcher, lookup: publicLookup })).rejects.toThrow("not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a hostname resolving to a private address", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const lookup = async () => ["192.168.1.10"];
    await expect(safeRemoteFetch("https://internal.example/page", { fetcher, lookup })).rejects.toThrow("not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("revalidates redirect destinations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://10.0.0.5/private" } })
    );
    const lookup = async (hostname: string) => (hostname === "public.example" ? ["93.184.216.34"] : ["10.0.0.5"]);
    await expect(safeRemoteFetch("https://public.example/start", { fetcher, lookup })).rejects.toThrow("not allowed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an HTTPS-to-HTTP redirect when the caller requires HTTPS", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://public.example/feed.xml" } })
    );

    await expect(safeRemoteFetch("https://public.example/feed.xml", {
      fetcher,
      lookup: publicLookup,
      allowedProtocols: ["https:"]
    })).rejects.toThrow("protocol is not allowed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds streamed response bodies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("12345", { status: 200, headers: { "content-length": "5" } })
    );
    await expect(safeRemoteFetch("https://example.com/page", { fetcher, lookup: publicLookup, maxBytes: 4 })).rejects.toThrow("size limit");
  });

  it("preserves a normal HTTPS response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await safeRemoteFetch("https://example.com/page", { fetcher, lookup: publicLookup });
    expect(result.url).toBe("https://example.com/page");
    expect(Buffer.from(result.body).toString()).toBe("ok");
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/page",
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) })
    );
  });

  it("pins the connection to the public address that passed validation", async () => {
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    const connector = vi.fn(async () => new Response("safe", { status: 200 }));

    const result = await safeRemoteFetch("https://example.com/article", { lookup, connector });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(connector).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "example.com" }),
      "93.184.216.34",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(Buffer.from(result.body).toString()).toBe("safe");
  });
});
