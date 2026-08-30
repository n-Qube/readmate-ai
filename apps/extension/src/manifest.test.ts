import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = resolve(__dirname, "..");

describe("extension packaging", () => {
  it("declares the ReadMate icon set for Chrome surfaces", () => {
    const manifest = JSON.parse(readFileSync(resolve(extensionRoot, "public/manifest.json"), "utf8"));
    const packageJson = JSON.parse(readFileSync(resolve(extensionRoot, "package.json"), "utf8"));

    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.icons).toEqual({
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    });
    expect(manifest.action.default_icon).toEqual({
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    });
    expect(manifest.permissions).toContain("cookies");
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.host_permissions).toEqual([
      "https://readmate-api-olm4au6qra-uc.a.run.app/*",
      "https://clerk.readmate.n-qube.com/*",
      "https://accounts.readmate.n-qube.com/*"
    ]);
    expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(manifest.commands["read-selection"].suggested_key.default).toBe("Alt+Shift+R");
    expect(manifest.commands["read-selection"].description).toContain("current page");
    for (const iconPath of Object.values(manifest.icons) as string[]) {
      expect(existsSync(resolve(extensionRoot, "public", iconPath))).toBe(true);
    }
    const logoSvg = readFileSync(resolve(extensionRoot, "public/icons/readmate-logo.svg"), "utf8");
    expect(logoSvg).toContain("readmateIconGradient");
    expect(logoSvg).toContain("badgeShadow");
  });

  it("cleans stale build output before Vite writes extension assets", () => {
    const packageJson = JSON.parse(readFileSync(resolve(extensionRoot, "package.json"), "utf8"));

    expect(packageJson.scripts.build).toBe("rm -rf dist && vite build");
  });
});
