#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = process.env.READMATE_GCP_PROJECT || "billbridge-c684f";
const REGION = process.env.READMATE_GCP_REGION || "us-central1";
const SERVICE = process.env.READMATE_GCP_SERVICE || "readmate-api";
const PROJECT_NUMBER = "862128227886";
const RUNTIME_ACCOUNT = `readmate-api@${PROJECT_ID}.iam.gserviceaccount.com`;
const BUILD_ACCOUNT = `${PROJECT_NUMBER}-compute@developer.gserviceaccount.com`;

const runtimeSecrets = new Map([
  ["CLERK_SECRET_KEY", "readmate-clerk-secret-key"],
  ["CLERK_PUBLISHABLE_KEY", "readmate-clerk-publishable-key"],
  ["DATABASE_URL", "readmate-database-app-url"],
  ["SUPABASE_URL", "readmate-supabase-url"],
  ["SUPABASE_SERVICE_ROLE_KEY", "readmate-supabase-service-role-key"],
  ["GEMINI_API_KEY", "readmate-gemini-api-key"],
  ["KHAYA_API_KEY", "readmate-khaya-api-key"],
  ["CARTESIA_API_KEY", "readmate-cartesia-api-key"],
  ["REVENUECAT_SECRET_API_KEY", "readmate-revenuecat-secret-api-key"],
  ["WEBMCP_AUDIT_DIGEST_KEY", "readmate-webmcp-audit-digest-key"],
  ["CRON_SECRET", "readmate-cron-secret"]
]);

const service = json(["run", "services", "describe", SERVICE, "--region", REGION, "--project", PROJECT_ID]);
const liveTraffic = service.status?.traffic?.find((entry) => entry.percent === 100);
if (!liveTraffic?.revisionName) fail("Cloud Run did not report a 100% live revision.");

const revision = json(["run", "revisions", "describe", liveTraffic.revisionName, "--region", REGION, "--project", PROJECT_ID]);
const liveEnvironment = new Map(
  (revision.spec?.containers?.[0]?.env ?? [])
    .filter((entry) => typeof entry.name === "string" && typeof entry.value === "string")
    .map((entry) => [entry.name, entry.value])
);

const migrationUrl = envFileValue(".env.local", "DATABASE_URL");
validateDatabaseUrl(liveEnvironment.get("DATABASE_URL"), "readmate_api", "runtime");
validateDatabaseUrl(migrationUrl, undefined, "migration");

const secretValues = new Map();
for (const [environmentName, secretName] of runtimeSecrets) {
  if (["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "REVENUECAT_SECRET_API_KEY", "WEBMCP_AUDIT_DIGEST_KEY"].includes(environmentName)) continue;
  const value = liveEnvironment.get(environmentName);
  if (!value) fail(`The live revision is missing ${environmentName}; no secrets were changed.`);
  secretValues.set(secretName, value);
}
secretValues.set("readmate-database-migration-url", migrationUrl);

const requiredExisting = [
  "readmate-clerk-secret-key",
  "readmate-clerk-publishable-key",
  "readmate-supabase-service-role-key",
  "readmate-revenuecat-secret-api-key",
  "readmate-webmcp-audit-digest-key"
];
for (const secretName of requiredExisting) {
  if (!resourceExists(["secrets", "describe", secretName, "--project", PROJECT_ID])) {
    fail(`Required existing secret ${secretName} is missing; no secrets were changed.`);
  }
}

console.log(`ReadMate secure deployment bootstrap (${APPLY ? "apply" : "dry run"})`);
console.log(`Live source revision: ${liveTraffic.revisionName}`);
console.log(`Runtime service account: ${RUNTIME_ACCOUNT}`);
for (const secretName of secretValues.keys()) {
  console.log(`Secret: ${secretName} (${resourceExists(["secrets", "describe", secretName, "--project", PROJECT_ID]) ? "preserve existing" : "create"})`);
}
for (const secretName of requiredExisting) console.log(`Secret: ${secretName} (preserve existing)`);

if (!APPLY) {
  console.log("Dry run complete. Re-run with --apply to create resources and IAM bindings.");
  process.exit(0);
}

if (!resourceExists(["iam", "service-accounts", "describe", RUNTIME_ACCOUNT, "--project", PROJECT_ID])) {
  run(["iam", "service-accounts", "create", "readmate-api", "--project", PROJECT_ID, "--display-name", "ReadMate API runtime"]);
}

for (const [secretName, value] of secretValues) {
  if (!resourceExists(["secrets", "describe", secretName, "--project", PROJECT_ID])) {
    run(["secrets", "create", secretName, "--project", PROJECT_ID, "--replication-policy", "automatic", "--data-file", "-"], value);
  }
}

for (const role of ["roles/serviceusage.serviceUsageConsumer", "roles/cloudtranslate.user"]) {
  run([
    "projects", "add-iam-policy-binding", PROJECT_ID,
    "--member", `serviceAccount:${RUNTIME_ACCOUNT}`,
    "--role", role,
    "--condition", "None"
  ]);
}

for (const secretName of [...runtimeSecrets.values()]) {
  run([
    "secrets", "add-iam-policy-binding", secretName,
    "--project", PROJECT_ID,
    "--member", `serviceAccount:${RUNTIME_ACCOUNT}`,
    "--role", "roles/secretmanager.secretAccessor",
    "--condition", "None"
  ]);
}

run([
  "secrets", "add-iam-policy-binding", "readmate-database-migration-url",
  "--project", PROJECT_ID,
  "--member", `serviceAccount:${BUILD_ACCOUNT}`,
  "--role", "roles/secretmanager.secretAccessor",
  "--condition", "None"
]);

run([
  "iam", "service-accounts", "add-iam-policy-binding", RUNTIME_ACCOUNT,
  "--project", PROJECT_ID,
  "--member", `serviceAccount:${BUILD_ACCOUNT}`,
  "--role", "roles/iam.serviceAccountUser",
  "--condition", "None"
]);

console.log("Secure deployment prerequisites are ready. Secret values were not printed.");

function json(args) {
  return JSON.parse(run([...args, "--format", "json"], undefined, true));
}

function resourceExists(args) {
  const result = spawnSync("gcloud", [...args, "--format", "none"], { encoding: "utf8" });
  return result.status === 0;
}

function run(args, input, capture = false) {
  const result = spawnSync("gcloud", args, {
    encoding: "utf8",
    input,
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "ignore", "pipe"]
  });
  if (result.status !== 0) {
    const message = result.stderr?.trim() || `gcloud exited with status ${result.status}`;
    fail(message);
  }
  return result.stdout ?? "";
}

function envFileValue(filePath, key) {
  const line = readFileSync(filePath, "utf8").split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) fail(`${filePath} does not contain ${key}; no secrets were changed.`);
  const raw = line.slice(key.length + 1).trim();
  const value = raw.replace(/^(['"])(.*)\1$/, "$2");
  if (!value) fail(`${filePath} contains an empty ${key}; no secrets were changed.`);
  return value;
}

function validateDatabaseUrl(value, expectedUserPrefix, label) {
  if (!value) fail(`The ${label} database URL is missing; no secrets were changed.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`The ${label} database URL is invalid; no secrets were changed.`);
  }
  if (!parsed.protocol.startsWith("postgres")) fail(`The ${label} database URL is not PostgreSQL; no secrets were changed.`);
  if (expectedUserPrefix && !decodeURIComponent(parsed.username).startsWith(expectedUserPrefix)) {
    fail(`The ${label} database URL does not use the expected application role; no secrets were changed.`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
