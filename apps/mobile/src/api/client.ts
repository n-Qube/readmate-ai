declare const __DEV__: boolean | undefined;

const isDevelopmentBuild = typeof __DEV__ === "undefined" ? process.env.NODE_ENV !== "production" : __DEV__;
const configuredApiBaseUrl =
  process.env.EXPO_PUBLIC_READMATE_API_URL ?? (isDevelopmentBuild ? "http://localhost:8787" : "");

if (!isDevelopmentBuild && (!configuredApiBaseUrl || !configuredApiBaseUrl.startsWith("https://"))) {
  throw new Error("EXPO_PUBLIC_READMATE_API_URL must be set to an HTTPS URL for release builds.");
}

export const apiBaseUrl = configuredApiBaseUrl.replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => undefined);
    throw new ApiError(error?.error ?? `Request failed with ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
