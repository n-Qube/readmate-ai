export const DEFAULT_SENSITIVE_AGENT_PATHNAMES = [
  "/settings",
  "/premium",
  "/account",
  "/billing",
  "/payment",
  "/password",
  "/provider-secrets"
] as const;

export function isAgentActionPathEnabled(
  pathname: string,
  enabled = true,
  sensitivePathnames: readonly string[] = DEFAULT_SENSITIVE_AGENT_PATHNAMES
): boolean {
  if (!enabled) return false;
  const normalized = normalizePathname(pathname);
  return !sensitivePathnames.some((route) => {
    const sensitive = normalizePathname(route);
    return normalized === sensitive || normalized.startsWith(`${sensitive}/`);
  });
}

function normalizePathname(value: string): string {
  const pathname = value.trim().split(/[?#]/, 1)[0] || "/";
  if (pathname === "/") return pathname;
  return `/${pathname.replace(/^\/+|\/+$/g, "")}`;
}
