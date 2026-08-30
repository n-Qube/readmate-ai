const developmentAccountPortal = "https://clever-sparrow-15.accounts.dev";
const developmentFrontendApi = "https://clever-sparrow-15.clerk.accounts.dev";

function getFrontendApiHost(key: string | undefined) {
  if (!key) return null;

  try {
    return atob(key.split("_")[2] ?? "").replace(/\$$/, "");
  } catch {
    return null;
  }
}

export function getAccountPortalOrigin(key: string | undefined) {
  const frontendApi = getFrontendApiHost(key);
  if (!frontendApi) return developmentAccountPortal;
  if (frontendApi.endsWith(".clerk.accounts.dev")) {
    return `https://${frontendApi.replace(".clerk.accounts.dev", ".accounts.dev")}`;
  }
  if (frontendApi.startsWith("clerk.")) {
    return `https://accounts.${frontendApi.slice("clerk.".length)}`;
  }
  return `https://${frontendApi}`;
}

export function getClerkFrontendOrigin(key: string | undefined) {
  const frontendApi = getFrontendApiHost(key);
  return frontendApi ? `https://${frontendApi}` : developmentFrontendApi;
}

export function getHostedAuthUrl(origin: string) {
  const url = new URL("/sign-in", origin);
  url.searchParams.set("redirect_url", origin);
  url.searchParams.set("sign_in_force_redirect_url", origin);
  url.searchParams.set("sign_up_force_redirect_url", origin);
  return url.toString();
}
