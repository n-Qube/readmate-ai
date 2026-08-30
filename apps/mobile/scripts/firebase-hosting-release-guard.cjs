#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  defaultConfigPath,
  firebaseTarget,
  validateFirebaseHosting
} = require("./validate-firebase-hosting.cjs");
const { validateWebDeployment } = require("./validate-web-deployment.cjs");

const mobileRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(mobileRoot, "../..");
const firebaseProjectId = "readmate-ai-9df42";
const forbiddenDefaultSiteId = "billbridge-c684f";
const defaultFirebasercPath = path.join(repositoryRoot, ".firebaserc");
const siteIdEnvironmentName = "READMATE_FIREBASE_SITE_ID";
const originTrialEnvironmentName = "READMATE_WEBMCP_ORIGIN_TRIAL_TOKEN";
const artifactShaEnvironmentName = "READMATE_FIREBASE_ARTIFACT_SHA256";
const expectedApiOriginEnvironmentName = "READMATE_EXPECTED_API_ORIGIN";
const releaseModeEnvironmentName = "READMATE_FIREBASE_RELEASE_MODE";
const productionWebOrigin = "https://app.readmate.n-qube.com";
const firebaseCliVersion = "15.4.0";

function validateFirebaseRelease({
  env = process.env,
  firebasercPath = defaultFirebasercPath,
  configPath = defaultConfigPath
} = {}) {
  const releaseMode = validateReleaseMode(env[releaseModeEnvironmentName]);
  const expectedSiteId = validateExpectedSiteId(env[siteIdEnvironmentName]);
  const originTrialToken = releaseMode === "preview" && !env[originTrialEnvironmentName]
    ? undefined
    : validateOriginTrialToken(env[originTrialEnvironmentName]);
  const expectedArtifactSha256 = validateArtifactSha256(env[artifactShaEnvironmentName]);
  const expectedApiOrigin = validateExpectedApiOrigin(
    env[expectedApiOriginEnvironmentName],
    { releaseMode }
  );
  const firebaserc = readRegularJson(firebasercPath, ".firebaserc");

  validateFirebaseTargetMapping({ firebaserc, expectedSiteId });
  validateFirebaseHosting({ configPath, env });
  validateReleaseEnvironment({ env, expectedApiOrigin });

  const baseConfig = readRegularJson(configPath, "Firebase Hosting config");
  const releaseConfig = createReleaseConfig({
    allowMissingOriginTrial: releaseMode === "preview",
    baseConfig,
    originTrialToken
  });
  const artifactRoot = path.resolve(mobileRoot, baseConfig.hosting.public);
  const artifactManifest = createHostingArtifactManifest(artifactRoot);
  assertArtifactManifestSha256({ artifactManifest, expectedArtifactSha256 });
  const bundledApiOrigin = validateBundledApiOrigin({
    artifactRoot,
    expectedApiOrigin,
    releaseMode
  });

  return {
    artifactManifest,
    artifactRoot,
    baseConfig,
    bundledApiOrigin,
    expectedApiOrigin,
    expectedArtifactSha256,
    expectedSiteId,
    firebaserc,
    firebasercPath: path.resolve(firebasercPath),
    originTrialToken,
    releaseMode,
    releaseConfig
  };
}

function validateArtifactSha256(value) {
  const sha256 = requireSingleLineValue(value, artifactShaEnvironmentName);
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`${artifactShaEnvironmentName} must be an exact lowercase SHA-256 digest.`);
  }
  return sha256;
}

function validateReleaseMode(value) {
  const releaseMode = requireSingleLineValue(value, releaseModeEnvironmentName);
  if (releaseMode !== "preview" && releaseMode !== "qa" && releaseMode !== "production") {
    throw new Error(`${releaseModeEnvironmentName} must be exactly preview, qa, or production.`);
  }
  return releaseMode;
}

function validateExpectedApiOrigin(value, { releaseMode }) {
  validateReleaseMode(releaseMode);
  const origin = requireSingleLineValue(value, expectedApiOriginEnvironmentName);
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`${expectedApiOriginEnvironmentName} must be an exact HTTPS origin.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`${expectedApiOriginEnvironmentName} must be an exact HTTPS origin with no path, query, or credentials.`);
  }
  const isTaggedCandidate = isReadMateCandidateOrigin(origin);
  if (releaseMode === "production" && isTaggedCandidate) {
    throw new Error(`${expectedApiOriginEnvironmentName} cannot be a tagged or candidate Cloud Run URL in production mode.`);
  }
  if ((releaseMode === "preview" || releaseMode === "qa") && !isTaggedCandidate) {
    throw new Error(`${expectedApiOriginEnvironmentName} must be an exact tagged ReadMate candidate URL in ${releaseMode} mode.`);
  }
  return origin;
}

function validateReleaseEnvironment({ env, expectedApiOrigin }) {
  const failures = [];
  if (env.APP_VARIANT !== "production") failures.push("APP_VARIANT must be exactly production");
  if (env.WEB_APP_ORIGIN !== productionWebOrigin) {
    failures.push(`WEB_APP_ORIGIN must be exactly ${productionWebOrigin}`);
  }
  if (env.EXPO_PUBLIC_READMATE_API_URL !== expectedApiOrigin) {
    failures.push(`EXPO_PUBLIC_READMATE_API_URL must exactly match ${expectedApiOriginEnvironmentName}`);
  }
  const clerkKey = env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!isProductionClerkPublishableKey(clerkKey)) {
    failures.push("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must be the reviewed live publishable key");
  }
  try {
    validateWebDeployment({
      env,
      exportDir: path.resolve(mobileRoot, "dist"),
      requireProductionEnvironment: true
    });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (failures.length) {
    throw new Error(`Firebase Hosting release environment validation failed:\n- ${failures.join("\n- ")}`);
  }
}

function isProductionClerkPublishableKey(value) {
  const match = /^pk_live_([A-Za-z0-9_-]+)$/.exec(value ?? "");
  if (!match) return false;
  try {
    const frontendApi = Buffer.from(match[1], "base64url").toString("utf8");
    return frontendApi.endsWith("$") && !frontendApi.endsWith(".clerk.accounts.dev$");
  } catch {
    return false;
  }
}

function createHostingArtifactManifest(artifactRoot) {
  const root = path.resolve(artifactRoot);
  const files = listArtifactFiles(root).map(({ absolute, relative }) => {
    const contents = fs.readFileSync(absolute);
    return {
      path: relative,
      sha256: crypto.createHash("sha256").update(contents).digest("hex"),
      size: contents.length
    };
  });
  const manifest = `${JSON.stringify({ version: 1, files })}\n`;
  return {
    fileCount: files.length,
    files,
    manifest,
    sha256: crypto.createHash("sha256").update(manifest).digest("hex")
  };
}

function assertArtifactManifestSha256({ artifactManifest, expectedArtifactSha256 }) {
  validateArtifactSha256(expectedArtifactSha256);
  if (artifactManifest.sha256 !== expectedArtifactSha256) {
    throw new Error(
      `Firebase Hosting artifact manifest SHA-256 mismatch: expected ${expectedArtifactSha256}, got ${artifactManifest.sha256}.`
    );
  }
}

function validateBundledApiOrigin({ artifactRoot, expectedApiOrigin, releaseMode }) {
  validateExpectedApiOrigin(expectedApiOrigin, { releaseMode });
  const failures = [];
  const observedOrigins = new Set();
  let expectedInApiBundle = false;

  for (const { absolute, relative } of listArtifactFiles(artifactRoot)) {
    if (!relative.endsWith(".js")) continue;
    const source = fs.readFileSync(absolute, "utf8");
    const fileOrigins = extractHttpsOrigins(source);
    for (const origin of fileOrigins) observedOrigins.add(origin);
    if (fileOrigins.has(expectedApiOrigin) && source.includes("apiBaseUrl")) {
      expectedInApiBundle = true;
    }
  }

  if (!observedOrigins.has(expectedApiOrigin)) {
    failures.push(`expected API origin ${expectedApiOrigin} is absent from the bundled JavaScript`);
  } else if (!expectedInApiBundle) {
    failures.push(`expected API origin ${expectedApiOrigin} is not present in the JavaScript API client bundle`);
  }

  const taggedOrigins = [...observedOrigins]
    .filter(isReadMateCandidateOrigin)
    .sort();
  if (releaseMode === "production" && taggedOrigins.length) {
    failures.push(`tagged or candidate API origin remains bundled: ${taggedOrigins.join(", ")}`);
  }
  if (releaseMode === "qa" && (taggedOrigins.length !== 1 || taggedOrigins[0] !== expectedApiOrigin)) {
    failures.push(`QA bundle must contain only the explicitly approved candidate origin ${expectedApiOrigin}`);
  }

  const otherReadMateCloudRunOrigins = [...observedOrigins]
    .filter((origin) => {
      const hostname = new URL(origin).hostname;
      return hostname.includes("readmate-api") && hostname.endsWith(".a.run.app") && origin !== expectedApiOrigin;
    })
    .sort();
  if (otherReadMateCloudRunOrigins.length) {
    failures.push(`unexpected ReadMate API origin remains bundled: ${otherReadMateCloudRunOrigins.join(", ")}`);
  }

  if (failures.length) {
    throw new Error(`Bundled API origin validation failed:\n- ${failures.join("\n- ")}`);
  }
  return { expectedApiOrigin, observedOrigins: [...observedOrigins].sort() };
}

function isReadMateCandidateOrigin(origin) {
  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return (
    hostname.startsWith("candidate-") &&
    hostname.includes("---readmate-api-") &&
    hostname.endsWith(".a.run.app")
  );
}

function extractHttpsOrigins(source) {
  const origins = new Set();
  for (const match of source.matchAll(/https:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)) {
    try {
      origins.add(new URL(match[0]).origin);
    } catch {
      // Ignore non-URL strings that only resemble a literal HTTPS origin.
    }
  }
  return origins;
}

function listArtifactFiles(artifactRoot, relativeRoot = "", files = []) {
  const root = path.resolve(artifactRoot);
  const current = path.join(root, relativeRoot);
  if (!fs.existsSync(current)) throw new Error(`Firebase Hosting artifact directory is missing: ${current}.`);
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Firebase Hosting artifact path must be a real directory: ${current}.`);
  }

  const entries = fs.readdirSync(current, { withFileTypes: true })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  for (const entry of entries) {
    const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    const absolute = path.join(root, ...relative.split("/"));
    if (entry.isSymbolicLink()) throw new Error(`Firebase Hosting artifact cannot contain symlink: ${absolute}.`);
    if (entry.isDirectory()) listArtifactFiles(root, relative, files);
    else if (entry.isFile()) files.push({ absolute, relative });
    else throw new Error(`Firebase Hosting artifact contains unsupported file type: ${absolute}.`);
  }
  return files;
}

function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function validateExpectedSiteId(value) {
  const siteId = requireSingleLineValue(value, siteIdEnvironmentName);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(siteId)) {
    throw new Error(`${siteIdEnvironmentName} must be a lowercase Firebase Hosting site ID.`);
  }
  if (siteId === forbiddenDefaultSiteId) {
    throw new Error(
      `${siteIdEnvironmentName} cannot be ${forbiddenDefaultSiteId}; that is the existing default BillBridge Hosting site.`
    );
  }
  return siteId;
}

function validateOriginTrialToken(value) {
  const token = requireSingleLineValue(value, originTrialEnvironmentName);
  if (token.length < 64 || !/^[A-Za-z0-9+/_=-]+$/.test(token)) {
    throw new Error(
      `${originTrialEnvironmentName} must be a real single-line Chrome Origin-Trial token, supplied only at release time.`
    );
  }
  if (/placeholder|example|replace|changeme|todo/i.test(token)) {
    throw new Error(`${originTrialEnvironmentName} cannot contain placeholder text.`);
  }
  return token;
}

function validateFirebaseTargetMapping({ firebaserc, expectedSiteId }) {
  if (firebaserc?.projects?.default === firebaseProjectId) {
    throw new Error(
      `.firebaserc cannot make ${firebaseProjectId} the default project; the guarded wrapper supplies it explicitly.`
    );
  }

  const targetOwners = [];
  for (const [projectId, projectTargets] of Object.entries(firebaserc?.targets ?? {})) {
    if (Object.prototype.hasOwnProperty.call(projectTargets?.hosting ?? {}, firebaseTarget)) {
      targetOwners.push(projectId);
    }
  }
  if (targetOwners.length !== 1 || targetOwners[0] !== firebaseProjectId) {
    throw new Error(
      `.firebaserc must define ${firebaseTarget} exactly once, under project ${firebaseProjectId}.`
    );
  }

  const mappedSites = firebaserc.targets[firebaseProjectId].hosting[firebaseTarget];
  if (!Array.isArray(mappedSites) || mappedSites.length !== 1) {
    throw new Error(
      `.firebaserc target ${firebaseTarget} must map to exactly one Firebase Hosting site.`
    );
  }
  if (mappedSites[0] === forbiddenDefaultSiteId) {
    throw new Error(
      `.firebaserc refuses ${firebaseTarget} -> ${forbiddenDefaultSiteId}; the existing default BillBridge site is protected.`
    );
  }
  if (mappedSites[0] !== expectedSiteId) {
    throw new Error(
      `.firebaserc maps ${firebaseTarget} to ${JSON.stringify(mappedSites[0])}, not the explicitly supplied site ${JSON.stringify(expectedSiteId)}.`
    );
  }
}

function createReleaseConfig({ baseConfig, originTrialToken, allowMissingOriginTrial = false }) {
  if (originTrialToken !== undefined || !allowMissingOriginTrial) {
    validateOriginTrialToken(originTrialToken);
  }
  const releaseConfig = JSON.parse(JSON.stringify(baseConfig));
  const headerRules = releaseConfig?.hosting?.headers;
  const globalHeaderRule = Array.isArray(headerRules)
    ? headerRules.find((rule) => rule?.source === "**")
    : undefined;
  if (!globalHeaderRule || !Array.isArray(globalHeaderRule.headers)) {
    throw new Error("Firebase Hosting config is missing the reviewed global response-header rule.");
  }

  const embeddedOriginTrialHeaders = globalHeaderRule.headers.filter(
    (header) => header?.key?.toLowerCase() === "origin-trial"
  );
  if (embeddedOriginTrialHeaders.length) {
    throw new Error(
      "firebase.web.json must not embed an Origin-Trial token; provide it through the deploy-time environment."
    );
  }
  const normalizedHeaderNames = globalHeaderRule.headers.map((header) => header?.key?.toLowerCase());
  if (new Set(normalizedHeaderNames).size !== normalizedHeaderNames.length) {
    throw new Error("firebase.web.json cannot contain duplicate response-header names.");
  }

  if (originTrialToken !== undefined) {
    globalHeaderRule.headers.push({ key: "Origin-Trial", value: originTrialToken });
  }
  const releaseOriginTrialHeaders = globalHeaderRule.headers.filter(
    (header) => header?.key?.toLowerCase() === "origin-trial"
  );
  if (originTrialToken === undefined && releaseOriginTrialHeaders.length !== 0) {
    throw new Error("preview release config cannot contain an Origin-Trial header without a registered token.");
  }
  if (originTrialToken !== undefined && (
    releaseOriginTrialHeaders.length !== 1 ||
    releaseOriginTrialHeaders[0].value !== originTrialToken
  )) {
    throw new Error("release config must contain exactly one deploy-time Origin-Trial header.");
  }

  return releaseConfig;
}

function deployFirebaseRelease(validation, { firebaseCli = "firebase" } = {}) {
  validateFirebaseCliVersion(firebaseCli);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "readmate-firebase-release-"));
  try {
    const stagedPublicRoot = path.join(stagingRoot, "public");
    copyTreeWithoutLinks(
      path.resolve(mobileRoot, validation.releaseConfig.hosting.public),
      stagedPublicRoot
    );
    assertArtifactManifestSha256({
      artifactManifest: createHostingArtifactManifest(stagedPublicRoot),
      expectedArtifactSha256: validation.expectedArtifactSha256
    });
    validateBundledApiOrigin({
      artifactRoot: stagedPublicRoot,
      expectedApiOrigin: validation.expectedApiOrigin,
      releaseMode: validation.releaseMode
    });

    const stagedConfig = JSON.parse(JSON.stringify(validation.releaseConfig));
    stagedConfig.hosting.public = "public";
    const stagedConfigPath = path.join(stagingRoot, "firebase.web.release.json");
    fs.writeFileSync(stagedConfigPath, `${JSON.stringify(stagedConfig, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(
      path.join(stagingRoot, ".firebaserc"),
      `${JSON.stringify(validation.firebaserc, null, 2)}\n`,
      { mode: 0o600 }
    );

    const childEnv = { ...process.env, FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true" };
    delete childEnv[originTrialEnvironmentName];
    delete childEnv[artifactShaEnvironmentName];
    delete childEnv[expectedApiOriginEnvironmentName];
    delete childEnv[releaseModeEnvironmentName];
    delete childEnv[siteIdEnvironmentName];

    const result = spawnSync(
      firebaseCli,
      [
        "deploy",
        "--non-interactive",
        "--project",
        firebaseProjectId,
        "--config",
        path.basename(stagedConfigPath),
        "--only",
        `hosting:${firebaseTarget}`
      ],
      { cwd: stagingRoot, env: childEnv, stdio: "inherit" }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Firebase Hosting deployment exited with status ${result.status}.`);
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function validateFirebaseCliVersion(firebaseCli) {
  const result = spawnSync(firebaseCli, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true" }
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.stdout.trim() !== firebaseCliVersion) {
    throw new Error(`Firebase CLI ${firebaseCliVersion} is required for the guarded Hosting release.`);
  }
}

function copyTreeWithoutLinks(sourceRoot, destinationRoot) {
  const sourceStat = fs.lstatSync(sourceRoot);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error(`validated Firebase Hosting output is not a safe directory: ${sourceRoot}`);
  }
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`refusing to stage symlink: ${source}`);
    if (entry.isDirectory()) copyTreeWithoutLinks(source, destination);
    else if (entry.isFile()) fs.copyFileSync(source, destination);
    else throw new Error(`refusing to stage unsupported file type: ${source}`);
  }
}

function readRegularJson(file, label) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`${label} is missing at ${resolved}.`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${resolved}.`);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireSingleLineValue(value, name) {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`${name} is required as an exact, non-empty single-line deploy-time value.`);
  }
  return value;
}

function parseMode(argv) {
  const supported = new Set(["--check-only", "--deploy", "--print-artifact-sha256"]);
  const unknown = argv.filter((argument) => !supported.has(argument));
  if (unknown.length) throw new Error(`Unsupported release-guard option: ${unknown.join(", ")}.`);
  const modes = argv.filter((argument) => supported.has(argument));
  if (modes.length !== 1) {
    throw new Error("Choose exactly one release-guard mode: --check-only, --deploy, or --print-artifact-sha256.");
  }
  if (modes[0] === "--deploy") return "deploy";
  if (modes[0] === "--print-artifact-sha256") return "print-artifact-sha256";
  return "check-only";
}

if (require.main === module) {
  try {
    const mode = parseMode(process.argv.slice(2));
    if (mode === "print-artifact-sha256") {
      validateFirebaseHosting();
      const config = readRegularJson(defaultConfigPath, "Firebase Hosting config");
      const artifact = createHostingArtifactManifest(path.resolve(mobileRoot, config.hosting.public));
      console.log(artifact.sha256);
      process.exit(0);
    }
    const validation = validateFirebaseRelease();
    if (mode === "deploy") {
      deployFirebaseRelease(validation);
      console.log(
        `Firebase Hosting ${validation.releaseMode} deployment completed for ${firebaseTarget} -> ${validation.expectedSiteId} in ${firebaseProjectId}.`
      );
    } else {
      console.log(
        `Firebase Hosting ${validation.releaseMode} release guard passed for ${firebaseTarget} -> ${validation.expectedSiteId} in ${firebaseProjectId}. No deployment was performed.`
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  artifactShaEnvironmentName,
  assertArtifactManifestSha256,
  createReleaseConfig,
  createHostingArtifactManifest,
  defaultFirebasercPath,
  deployFirebaseRelease,
  firebaseProjectId,
  forbiddenDefaultSiteId,
  originTrialEnvironmentName,
  expectedApiOriginEnvironmentName,
  extractHttpsOrigins,
  isProductionClerkPublishableKey,
  listArtifactFiles,
  parseMode,
  siteIdEnvironmentName,
  releaseModeEnvironmentName,
  productionWebOrigin,
  validateExpectedSiteId,
  validateArtifactSha256,
  validateBundledApiOrigin,
  validateExpectedApiOrigin,
  validateFirebaseCliVersion,
  validateFirebaseRelease,
  validateFirebaseTargetMapping,
  validateOriginTrialToken,
  validateReleaseEnvironment,
  validateReleaseMode
};
