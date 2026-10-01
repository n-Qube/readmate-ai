const PUBLIC_CLIENT_VARIABLES = Object.freeze([
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_READMATE_API_URL",
  "EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY",
  "EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY",
  "EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID",
  "EXPO_PUBLIC_PREMIUM_PURCHASES_ENABLED",
  "EXPO_PUBLIC_PHONE_OTP_ENABLED",
  "EXPO_PUBLIC_SCREENSHOT_MODE"
]);

const PUBLIC_CLIENT_VARIABLE_SET = new Set(PUBLIC_CLIENT_VARIABLES);
// Expo Router injects this transient build variable while evaluating the app
// config during server rendering. It is not a user-configurable client value.
const FRAMEWORK_MANAGED_PUBLIC_VARIABLE_SET = new Set(["EXPO_PUBLIC_PROJECT_ROOT"]);
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /\bsk_(?:live|test)_[A-Za-z0-9_-]{12,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\b(?:postgres|postgresql):\/\//i,
  /"private_key"\s*:/i
];

function assertSafePublicEnvironment(env, { production = false } = {}) {
  const unexpected = Object.keys(env)
    .filter((name) =>
      name.startsWith("EXPO_PUBLIC_") &&
      !PUBLIC_CLIENT_VARIABLE_SET.has(name) &&
      !FRAMEWORK_MANAGED_PUBLIC_VARIABLE_SET.has(name)
    )
    .sort();

  if (unexpected.length) {
    throw new Error(
      `Unexpected Expo public environment variable(s): ${unexpected.join(", ")}. ` +
      "Public variables are bundled into the web and native clients; add only reviewed, non-secret names to the allowlist."
    );
  }

  for (const name of PUBLIC_CLIENT_VARIABLES) {
    const value = env[name]?.trim();
    if (!value) continue;
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error(`${name} contains a server-secret-shaped value and cannot be included in a public client bundle.`);
    }
  }

  if (production && env.EXPO_PUBLIC_SCREENSHOT_MODE?.trim() === "1") {
    throw new Error("Production client bundles cannot enable EXPO_PUBLIC_SCREENSHOT_MODE.");
  }
}

function parseExactHttpsOrigin(name, value) {
  if (!value?.trim()) throw new Error(`${name} is required.`);

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be an exact HTTPS origin.`);
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== "/")
  ) {
    throw new Error(`${name} must be an exact HTTPS origin without credentials, a path, query, or fragment.`);
  }

  return parsed.origin;
}

module.exports = {
  PUBLIC_CLIENT_VARIABLES,
  PUBLIC_CLIENT_VARIABLE_SET,
  FRAMEWORK_MANAGED_PUBLIC_VARIABLE_SET,
  assertSafePublicEnvironment,
  parseExactHttpsOrigin
};
