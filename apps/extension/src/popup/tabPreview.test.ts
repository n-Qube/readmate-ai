import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveTabPreview } from "./tabPreview";

describe("getActiveTabPreview", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("chrome", {
      tabs: {
        query
      }
    });
  });

  it("returns a compact preview for the current readable tab", async () => {
    query.mockResolvedValue([
      {
        favIconUrl: "https://example.com/favicon.ico",
        title: "Valve jacks up Steam Deck prices by as much as $300",
        url: "https://www.engadget.com/2182286/valve-jacks-up-steam-deck-prices-by-as-much-as-300/"
      }
    ]);

    await expect(getActiveTabPreview()).resolves.toEqual({
      domain: "engadget.com",
      faviconUrl: "https://example.com/favicon.ico",
      initial: "E",
      readable: true,
      title: "Valve jacks up Steam Deck prices by as much as $300"
    });
  });

  it("returns an unsupported preview when Chrome has no readable active tab", async () => {
    query.mockResolvedValue([
      {
        title: "Extensions",
        url: "chrome://extensions/"
      }
    ]);

    await expect(getActiveTabPreview()).resolves.toMatchObject({
      domain: "Chrome page",
      initial: "R",
      readable: false,
      title: "Open a readable web page"
    });
  });
});
