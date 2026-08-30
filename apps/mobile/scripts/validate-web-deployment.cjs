#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  PUBLIC_CLIENT_VARIABLE_SET,
  assertSafePublicEnvironment,
  parseExactHttpsOrigin
} = require("./public-env-contract.cjs");

const mobileRoot = path.resolve(__dirname, "..");
const requiredHeaders = Object.freeze({
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "tools=(self)",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

function validateWebDeployment({
  env = process.env,
  exportDir,
  requireProductionEnvironment = false
} = {}) {
  const failures = [];
  const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8"));
  const expo = appJson.expo ?? {};

  if (expo.web?.bundler !== "metro") failures.push("expo.web.bundler must be metro");
  if (expo.web?.output !== "server") {
    failures.push("expo.web.output must be server so EAS Hosting serves dynamic routes with the configured headers");
  }

  const routerPlugin = (expo.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-router"
  );
  const configuredHeaders = routerPlugin?.[1]?.headers ?? {};
  for (const [name, value] of Object.entries(requiredHeaders)) {
    if (configuredHeaders[name] !== value) {
      failures.push(`expo-router header ${name} must equal ${JSON.stringify(value)}`);
    }
  }

  try {
    assertSafePublicEnvironment(env, { production: requireProductionEnvironment });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (requireProductionEnvironment) {
    if ((env.APP_VARIANT || "production") !== "production") {
      failures.push("production web export requires APP_VARIANT=production");
    }

    try {
      const apiOrigin = parseExactHttpsOrigin("EXPO_PUBLIC_READMATE_API_URL", env.EXPO_PUBLIC_READMATE_API_URL);
      const webOrigin = parseExactHttpsOrigin("WEB_APP_ORIGIN", env.WEB_APP_ORIGIN);
      if (apiOrigin === webOrigin) failures.push("WEB_APP_ORIGIN must be separate from the API origin");
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (exportDir) validateExport(path.resolve(exportDir), failures, env);

  if (failures.length) {
    const error = new Error(`Web deployment validation failed:\n- ${failures.join("\n- ")}`);
    error.failures = failures;
    throw error;
  }
}

function validateExport(exportRoot, failures, env) {
  const routesFile = path.join(exportRoot, "server", "_expo", "routes.json");
  if (!fs.existsSync(routesFile)) {
    failures.push("export is missing server/_expo/routes.json; run the server-mode Expo web export first");
    return;
  }

  const routes = JSON.parse(fs.readFileSync(routesFile, "utf8"));
  for (const [name, value] of Object.entries(requiredHeaders)) {
    if (routes.headers?.[name] !== value) {
      failures.push(`exported route header ${name} must equal ${JSON.stringify(value)}`);
    }
  }

  const artifactFiles = walk(exportRoot).filter((file) => /\.(?:html|js|json)$/i.test(file));
  const forbiddenNames = [
    "CLERK_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "REVENUECAT_SECRET_API_KEY",
    "WEBMCP_AUDIT_DIGEST_KEY",
    "DATABASE_URL",
    "CRON_SECRET",
    "GEMINI_API_KEY",
    "CARTESIA_API_KEY",
    "KHAYA_API_KEY",
    "GOOGLE_SERVICE_ACCOUNT_JSON"
  ];
  const forbiddenValues = forbiddenNames
    .map((name) => [name, env[name]?.trim()])
    .filter((entry) => entry[1] && entry[1].length >= 8);

  for (const file of artifactFiles) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(exportRoot, file);
    if (forbiddenNames.some((name) => referencesProcessEnvironment(source, name))) {
      failures.push(`${relative} reads a backend-only environment variable`);
    }
    if (
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source) ||
      /\bsk_(?:live|test)_[A-Za-z0-9_-]{12,}\b/.test(source) ||
      /\b(?:postgres|postgresql):\/\/[^\s"']+/i.test(source)
    ) {
      failures.push(`${relative} contains server-secret-shaped content`);
    }
    for (const [name, value] of forbiddenValues) {
      if (source.includes(value)) failures.push(`${relative} contains the value of backend-only ${name}`);
    }
  }
}

function referencesProcessEnvironment(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\bprocess\\s*\\.\\s*env\\s*(?:\\.\\s*${escaped}\\b|\\[\\s*["']${escaped}["']\\s*\\])`
  ).test(source);
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, files);
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

if (require.main === module) {
  const exportIndex = process.argv.indexOf("--export-dir");
  const exportDir = exportIndex >= 0 ? process.argv[exportIndex + 1] : undefined;
  const requireProductionEnvironment = process.argv.includes("--production-env");
  try {
    validateWebDeployment({ exportDir, requireProductionEnvironment });
    const suffix = exportDir ? " and exported routes" : "";
    console.log(`Web deployment validation passed: Expo hosting configuration${suffix} satisfies the source-controlled contract.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { requiredHeaders, validateWebDeployment };
