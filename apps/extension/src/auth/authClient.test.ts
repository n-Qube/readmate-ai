import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthSession } from "./authClient";

describe("getAuthSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts signed out and purges a raw token left by an older build", async () => {
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", { storage: { local: { remove, get: vi.fn(async () => ({ readmateSessionToken: "stale-token" })) } } });

    await expect(getAuthSession()).resolves.toEqual({ isSignedIn: false, token: null, userName: "Anonymous reader" });
    expect(remove).toHaveBeenCalledWith(["readmateSessionToken", "readmateUserName", "readmateAvatarUrl"]);
  });
});
