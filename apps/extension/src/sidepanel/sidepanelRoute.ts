export const SIDE_PANEL_ROUTE_KEY = "readmateSidePanelRoute";
export const SIDE_PANEL_ROUTE_MAX_AGE_MS = 60_000;

export type SidePanelTab = "read" | "learn" | "library" | "history" | "settings";

export type SidePanelRoute = {
  tab: SidePanelTab;
  requestedAt: number;
};

const SIDE_PANEL_TABS = new Set<SidePanelTab>(["read", "learn", "library", "history", "settings"]);

export function createSidePanelRoute(tab: SidePanelTab, requestedAt = Date.now()): SidePanelRoute {
  return { tab, requestedAt };
}

export function parseSidePanelRoute(value: unknown, now = Date.now()): SidePanelRoute | null {
  if (!value || typeof value !== "object") return null;
  const route = value as Record<string, unknown>;
  if (typeof route.tab !== "string" || !SIDE_PANEL_TABS.has(route.tab as SidePanelTab)) return null;
  if (typeof route.requestedAt !== "number" || !Number.isFinite(route.requestedAt)) return null;
  if (route.requestedAt > now + 5_000 || now - route.requestedAt > SIDE_PANEL_ROUTE_MAX_AGE_MS) return null;
  return { tab: route.tab as SidePanelTab, requestedAt: route.requestedAt };
}
