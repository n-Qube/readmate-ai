import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

type GoogleTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let googleTokenCache: GoogleTokenCache | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 60_000) {
    return googleTokenCache.accessToken;
  }

  const credentials = loadGoogleServiceAccount();
  if (!credentials) {
    return getGoogleMetadataAccessToken();
  }

  const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claim = base64UrlJson({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  });
  const unsignedJwt = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(credentials.private_key.replace(/\\n/g, "\n"), "base64url");
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetchWithTimeout(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const body = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? "Unable to authenticate with Google Cloud.");
  }

  googleTokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
  };
  return googleTokenCache.accessToken;
}

async function getGoogleMetadataAccessToken(): Promise<string> {
  const response = await fetchWithTimeout("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(3_000)
  }, { timeoutMs: 3_000 });
  const body = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ??
        body.error ??
        "Google Cloud credentials are not configured. Set GOOGLE_TRANSLATE_API_KEY, GOOGLE_TTS_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_JSON, or run on Google Cloud with a service account."
    );
  }

  googleTokenCache = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
  };
  return googleTokenCache.accessToken;
}

function loadGoogleServiceAccount(): GoogleServiceAccount | null {
  const rawServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawServiceAccount) {
    try {
      return JSON.parse(rawServiceAccount) as GoogleServiceAccount;
    } catch {
      return JSON.parse(Buffer.from(rawServiceAccount, "base64").toString("utf8")) as GoogleServiceAccount;
    }
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")) as GoogleServiceAccount;
  }
  return null;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function resetGoogleTokenCacheForTests(): void {
  googleTokenCache = null;
}
