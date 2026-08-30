import { describe, expect, it } from "vitest";
import { getAccountPortalOrigin, getClerkFrontendOrigin, getHostedAuthUrl } from "./clerkUrls";

describe("Clerk account portal URLs", () => {
  it("maps a production Clerk frontend domain to its account portal", () => {
    expect(getAccountPortalOrigin("pk_live_Y2xlcmsucmVhZG1hdGUubi1xdWJlLmNvbSQ")).toBe(
      "https://accounts.readmate.n-qube.com"
    );
  });

  it("keeps the production Clerk frontend domain for session synchronization", () => {
    expect(getClerkFrontendOrigin("pk_live_Y2xlcmsucmVhZG1hdGUubi1xdWJlLmNvbSQ")).toBe(
      "https://clerk.readmate.n-qube.com"
    );
  });

  it("keeps the development accounts.dev mapping", () => {
    expect(getAccountPortalOrigin("pk_test_Y2xldmVyLXNwYXJyb3ctMTUuY2xlcmsuYWNjb3VudHMuZGV2JA")).toBe(
      "https://clever-sparrow-15.accounts.dev"
    );
  });

  it("keeps the development Clerk frontend domain for session synchronization", () => {
    expect(getClerkFrontendOrigin("pk_test_Y2xldmVyLXNwYXJyb3ctMTUuY2xlcmsuYWNjb3VudHMuZGV2JA")).toBe(
      "https://clever-sparrow-15.clerk.accounts.dev"
    );
  });

  it("builds hosted sign-in redirects on the account portal", () => {
    const url = new URL(getHostedAuthUrl("https://accounts.readmate.n-qube.com"));
    expect(url.origin).toBe("https://accounts.readmate.n-qube.com");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("redirect_url")).toBe("https://accounts.readmate.n-qube.com");
  });
});
