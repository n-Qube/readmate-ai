// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as WebBrowser from "expo-web-browser";
import OAuthCallbackScreen from "../../app/callback";

vi.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: vi.fn() }));
vi.mock("react-native", () => ({ Text: "span", View: "div" }));
vi.mock("expo-router", () => ({ Link: "a" }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/");
});

async function renderCallback() {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<OAuthCallbackScreen />));
  return container;
}

describe("OAuth callback handoff", () => {
  it("delegates to Expo with all default verification checks and retains the callback until the opener completes", async () => {
    window.history.replaceState(null, "", "/callback?test=handoff");
    vi.mocked(WebBrowser.maybeCompleteAuthSession).mockReturnValue({ type: "success", message: "Completed" });
    const container = await renderCallback();
    expect(WebBrowser.maybeCompleteAuthSession).toHaveBeenCalledExactlyOnceWith();
    expect(window.location.pathname + window.location.search).toBe("/callback?test=handoff");
    expect(container.textContent).toContain("original ReadMate tab");
    expect(container.querySelector("a")).toBeNull();
  });

  it.each(["failed", "throw"])("offers a token-free retry when completion %s", async (outcome) => {
    const sensitiveMessage = "private callback URL must not be displayed";
    if (outcome === "throw") {
      vi.mocked(WebBrowser.maybeCompleteAuthSession).mockImplementation(() => { throw new Error(sensitiveMessage); });
    } else {
      vi.mocked(WebBrowser.maybeCompleteAuthSession).mockReturnValue({ type: "failed", message: sensitiveMessage });
    }
    const container = await renderCallback();
    expect(container.textContent).toContain("Sign-in could not be completed");
    expect(container.textContent).not.toContain(sensitiveMessage);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
  });
});
