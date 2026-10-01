/// <reference types="node" />
import { createElement } from "react";
import { readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { getRoutes } from "expo-router/build/getRoutesCore";
import { describe, expect, it, vi } from "vitest";
import * as WebBrowser from "expo-web-browser";
import NativeOAuthCallbackScreen from "../../app/callback.native";

vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => createElement("a", { href }, "Return to ReadMate")
}));
vi.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: vi.fn(() => ({ type: "failed", message: "Not supported on this platform" }))
}));

describe("native OAuth callback", () => {
  it("returns to the auth-aware app entry without a web-only completion check", () => {
    const html = renderToStaticMarkup(createElement(NativeOAuthCallbackScreen));
    expect(html).toContain('href="/"');
    expect(html).not.toContain("Sign-in could not be completed");
    expect(WebBrowser.maybeCompleteAuthSession).not.toHaveBeenCalled();
  });

  it.each(["android", "ios", "web"])("selects the correct callback handler on %s", (platform) => {
    const callbackFiles = readdirSync(new URL("../../app", import.meta.url))
      .filter((file) => /^callback(?:\.native)?\.tsx$/.test(file));
    const context = Object.assign(() => ({ default: () => null }), {
      keys: () => ["./_layout.tsx", "./index.tsx", ...callbackFiles.map((file) => `./${file}`)],
      resolve: (key: string) => key,
      id: "callback-regression"
    });
    const route = getRoutes(context, {
      platform,
      ignoreEntryPoints: true,
      getSystemRoute: ({ route, type }) => ({
        route, type, contextKey: `./${route}.tsx`, children: [], dynamic: null,
        loadRoute: () => ({ default: () => null })
      })
    })?.children.find((node) => node.route === "callback");
    expect(route?.contextKey).toBe(platform === "web" ? "./callback.tsx" : "./callback.native.tsx");
  });
});
