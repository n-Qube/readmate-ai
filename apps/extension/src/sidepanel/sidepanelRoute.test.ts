import { describe, expect, it } from "vitest";
import { createSidePanelRoute, parseSidePanelRoute, SIDE_PANEL_ROUTE_MAX_AGE_MS } from "./sidepanelRoute";

describe("side-panel routes", () => {
  it("accepts a fresh Library request", () => {
    const now = 10_000;
    expect(parseSidePanelRoute(createSidePanelRoute("library", now), now)).toEqual({ tab: "library", requestedAt: now });
  });

  it("rejects stale and unknown requests", () => {
    const now = 100_000;
    expect(parseSidePanelRoute({ tab: "library", requestedAt: now - SIDE_PANEL_ROUTE_MAX_AGE_MS - 1 }, now)).toBeNull();
    expect(parseSidePanelRoute({ tab: "billing", requestedAt: now }, now)).toBeNull();
  });
});
