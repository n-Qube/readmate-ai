const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  artifactShaEnvironmentName,
  assertArtifactManifestSha256,
  createHostingArtifactManifest,
  createReleaseConfig,
  deployFirebaseRelease,
  expectedApiOriginEnvironmentName,
  firebaseProjectId,
  forbiddenDefaultSiteId,
  originTrialEnvironmentName,
  isProductionClerkPublishableKey,
  parseMode,
  releaseModeEnvironmentName,
  siteIdEnvironmentName,
  validateArtifactSha256,
  validateBundledApiOrigin,
  validateExpectedApiOrigin,
  validateExpectedSiteId,
  validateFirebaseTargetMapping,
  validateOriginTrialToken,
  validateReleaseMode
} = require("./firebase-hosting-release-guard.cjs");
const { defaultConfigPath } = require("./validate-firebase-hosting.cjs");

const approvedSiteId = "readmate-ai-9df42";
const syntheticOriginTrialToken = "A".repeat(128);
const stableApiOrigin = "https://readmate-api-olm4au6qra-uc.a.run.app";
const candidateApiOrigin = "https://candidate-e6bf9ac4a324---readmate-api-olm4au6qra-uc.a.run.app";

test("accepts exactly one explicit ReadMate target mapping without a production default alias", () => {
  const firebaserc = createFirebaserc(approvedSiteId);
  assert.doesNotThrow(() => validateFirebaseTargetMapping({ firebaserc, expectedSiteId: approvedSiteId }));

  firebaserc.projects.default = firebaseProjectId;
  assert.throws(
    () => validateFirebaseTargetMapping({ firebaserc, expectedSiteId: approvedSiteId }),
    /cannot make readmate-ai-9df42 the default project/
  );
});

test("refuses the existing default BillBridge Hosting site", () => {
  assert.throws(
    () => validateExpectedSiteId(forbiddenDefaultSiteId),
    /existing default BillBridge Hosting site/
  );
  assert.throws(
    () => validateFirebaseTargetMapping({
      firebaserc: createFirebaserc(forbiddenDefaultSiteId),
      expectedSiteId: approvedSiteId
    }),
    /default BillBridge site is protected/
  );
});

test("refuses wrong, ambiguous, or cross-project target mappings", () => {
  const wrongSite = createFirebaserc("readmate-other-site");
  assert.throws(
    () => validateFirebaseTargetMapping({ firebaserc: wrongSite, expectedSiteId: approvedSiteId }),
    /not the explicitly supplied site/
  );

  const multipleSites = createFirebaserc(approvedSiteId);
  multipleSites.targets[firebaseProjectId].hosting["readmate-web"].push("readmate-second-site");
  assert.throws(
    () => validateFirebaseTargetMapping({ firebaserc: multipleSites, expectedSiteId: approvedSiteId }),
    /exactly one Firebase Hosting site/
  );

  const crossProject = createFirebaserc(approvedSiteId);
  crossProject.targets["another-project"] = { hosting: { "readmate-web": [approvedSiteId] } };
  assert.throws(
    () => validateFirebaseTargetMapping({ firebaserc: crossProject, expectedSiteId: approvedSiteId }),
    /exactly once/
  );
});

test("requires explicit deploy-time site, trial token, artifact hash, and release mode", () => {
  assert.throws(() => validateExpectedSiteId(undefined), new RegExp(siteIdEnvironmentName));
  assert.throws(() => validateOriginTrialToken(undefined), new RegExp(originTrialEnvironmentName));
  assert.throws(() => validateArtifactSha256(undefined), new RegExp(artifactShaEnvironmentName));
  assert.throws(() => validateReleaseMode(undefined), new RegExp(releaseModeEnvironmentName));
  assert.throws(() => validateOriginTrialToken("placeholder"), /real single-line Chrome Origin-Trial token/);
  assert.throws(() => validateArtifactSha256("A".repeat(64)), /lowercase SHA-256/);
  assert.equal(validateExpectedSiteId(approvedSiteId), approvedSiteId);
  assert.equal(validateOriginTrialToken(syntheticOriginTrialToken), syntheticOriginTrialToken);
  assert.equal(validateReleaseMode("qa"), "qa");
  assert.equal(validateReleaseMode("preview"), "preview");
  assert.equal(validateReleaseMode("production"), "production");
});

test("matches the production Clerk publishable-key semantics used by app.config.js", () => {
  assert.equal(
    isProductionClerkPublishableKey("pk_live_Y2xlcmsucmVhZG1hdGUubi1xdWJlLmNvbSQ"),
    true
  );
  assert.equal(
    isProductionClerkPublishableKey(`pk_live_${Buffer.from("tenant.clerk.accounts.dev$").toString("base64url")}`),
    false
  );
  assert.equal(isProductionClerkPublishableKey("pk_live_aW52YWxpZA"), false);
  assert.equal(isProductionClerkPublishableKey("pk_test_Y2xlcmsucmVhZG1hdGUubi1xdWJlLmNvbSQ"), false);
});

test("uses distinct exact API-origin policies for QA and production", () => {
  assert.equal(validateExpectedApiOrigin(candidateApiOrigin, { releaseMode: "qa" }), candidateApiOrigin);
  assert.equal(validateExpectedApiOrigin(candidateApiOrigin, { releaseMode: "preview" }), candidateApiOrigin);
  assert.equal(validateExpectedApiOrigin(stableApiOrigin, { releaseMode: "production" }), stableApiOrigin);
  assert.throws(
    () => validateExpectedApiOrigin(candidateApiOrigin, { releaseMode: "production" }),
    /candidate Cloud Run URL in production mode/
  );
  assert.throws(
    () => validateExpectedApiOrigin(stableApiOrigin, { releaseMode: "qa" }),
    /tagged ReadMate candidate URL in qa mode/
  );
  assert.throws(
    () => validateExpectedApiOrigin(`${stableApiOrigin}/v1`, { releaseMode: "production" }),
    new RegExp(expectedApiOriginEnvironmentName)
  );
});

test("builds a deterministic, content-bound Hosting artifact manifest", (t) => {
  const root = createTemporaryDirectory(t, "readmate-artifact-manifest-");
  write(path.join(root, "z.html"), "z");
  write(path.join(root, "assets/a.js"), "a");
  const first = createHostingArtifactManifest(root);
  fs.utimesSync(path.join(root, "z.html"), new Date(), new Date());
  const second = createHostingArtifactManifest(root);

  assert.equal(first.sha256, second.sha256, "timestamps must not affect the manifest");
  assert.deepEqual(first.files.map((file) => file.path), ["assets/a.js", "z.html"]);
  assert.doesNotThrow(() => assertArtifactManifestSha256({
    artifactManifest: first,
    expectedArtifactSha256: first.sha256
  }));

  write(path.join(root, "assets/a.js"), "changed");
  const changed = createHostingArtifactManifest(root);
  assert.notEqual(changed.sha256, first.sha256);
  assert.throws(
    () => assertArtifactManifestSha256({
      artifactManifest: changed,
      expectedArtifactSha256: first.sha256
    }),
    /artifact manifest SHA-256 mismatch/
  );
});

test("rejects symlinks from the Hosting artifact manifest", (t) => {
  const root = createTemporaryDirectory(t, "readmate-artifact-symlink-");
  write(path.join(root, "real.js"), "safe");
  fs.symlinkSync(path.join(root, "real.js"), path.join(root, "linked.js"));
  assert.throws(() => createHostingArtifactManifest(root), /cannot contain symlink/);
});

test("proves the exact bundled API origin and rejects mixed or stale origins", (t) => {
  const productionRoot = createApiArtifact(t, stableApiOrigin, "production-");
  assert.doesNotThrow(() => validateBundledApiOrigin({
    artifactRoot: productionRoot,
    expectedApiOrigin: stableApiOrigin,
    releaseMode: "production"
  }));

  const qaRoot = createApiArtifact(t, candidateApiOrigin, "qa-");
  assert.doesNotThrow(() => validateBundledApiOrigin({
    artifactRoot: qaRoot,
    expectedApiOrigin: candidateApiOrigin,
    releaseMode: "qa"
  }));

  write(path.join(productionRoot, "legacy.js"), `const oldApi = ${JSON.stringify(candidateApiOrigin)};`);
  assert.throws(
    () => validateBundledApiOrigin({
      artifactRoot: productionRoot,
      expectedApiOrigin: stableApiOrigin,
      releaseMode: "production"
    }),
    /candidate API origin remains bundled/
  );

  assert.throws(
    () => validateBundledApiOrigin({
      artifactRoot: productionRoot,
      expectedApiOrigin: "https://api.readmate.n-qube.com",
      releaseMode: "production"
    }),
    /absent from the bundled JavaScript/
  );
});

test("injects exactly one deploy-time Origin-Trial header without mutating the local config", () => {
  const baseConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
  const releaseConfig = createReleaseConfig({ baseConfig, originTrialToken: syntheticOriginTrialToken });
  const baseHeaders = baseConfig.hosting.headers[0].headers;
  const releaseHeaders = releaseConfig.hosting.headers[0].headers;

  assert.equal(baseHeaders.some((header) => header.key === "Origin-Trial"), false);
  assert.deepEqual(
    releaseHeaders.filter((header) => header.key === "Origin-Trial"),
    [{ key: "Origin-Trial", value: syntheticOriginTrialToken }]
  );
});

test("allows a Firebase preview without claiming an unregistered Origin-Trial token", () => {
  const baseConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
  const releaseConfig = createReleaseConfig({
    allowMissingOriginTrial: true,
    baseConfig,
    originTrialToken: undefined
  });
  assert.equal(
    releaseConfig.hosting.headers[0].headers.some((header) => header.key === "Origin-Trial"),
    false
  );
  assert.equal(
    baseConfig.hosting.headers[0].headers.some((header) => header.key === "Origin-Trial"),
    false
  );
});

test("refuses embedded Origin-Trial values and case-insensitive duplicate headers", () => {
  const embeddedConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
  embeddedConfig.hosting.headers[0].headers.push({ key: "Origin-Trial", value: "B".repeat(128) });
  assert.throws(
    () => createReleaseConfig({ baseConfig: embeddedConfig, originTrialToken: syntheticOriginTrialToken }),
    /must not embed an Origin-Trial token/
  );

  const duplicateConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
  duplicateConfig.hosting.headers[0].headers.push({ key: "x-frame-options", value: "DENY" });
  assert.throws(
    () => createReleaseConfig({ baseConfig: duplicateConfig, originTrialToken: syntheticOriginTrialToken }),
    /duplicate response-header names/
  );
});

test("requires an explicit safe execution mode", () => {
  assert.equal(parseMode(["--check-only"]), "check-only");
  assert.equal(parseMode(["--deploy"]), "deploy");
  assert.equal(parseMode(["--print-artifact-sha256"]), "print-artifact-sha256");
  assert.throws(() => parseMode([]), /Choose exactly one/);
  assert.throws(() => parseMode(["--deploy", "--check-only"]), /Choose exactly one/);
  assert.throws(() => parseMode(["--deploy", "--project", "other"]), /Unsupported release-guard option/);
});

test("guarded deploy re-hashes staging, fixes project/target, and withholds release inputs", (t) => {
  const fixtureRoot = createTemporaryDirectory(t, "readmate-firebase-guard-test-");
  const sourcePublic = path.join(fixtureRoot, "source-public");
  const capturePath = path.join(fixtureRoot, "capture.json");
  const fakeFirebase = path.join(fixtureRoot, "fake-firebase.cjs");
  write(path.join(sourcePublic, "index.html"), "readmate");
  write(path.join(sourcePublic, "assets/app.js"), `const apiBaseUrl = ${JSON.stringify(stableApiOrigin)};`);
  write(fakeFirebase, `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  console.log("15.4.0");
  process.exit(0);
}
const fs = require("node:fs");
const path = require("node:path");
const configName = process.argv[process.argv.indexOf("--config") + 1];
fs.writeFileSync(process.env.READMATE_FAKE_FIREBASE_CAPTURE, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  releaseEnvironment: {
    token: process.env.${originTrialEnvironmentName},
    artifact: process.env.${artifactShaEnvironmentName},
    api: process.env.${expectedApiOriginEnvironmentName},
    mode: process.env.${releaseModeEnvironmentName},
    site: process.env.${siteIdEnvironmentName}
  },
  config: JSON.parse(fs.readFileSync(path.join(process.cwd(), configName), "utf8")),
  firebaserc: JSON.parse(fs.readFileSync(path.join(process.cwd(), ".firebaserc"), "utf8")),
  publicBody: fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8")
}));
`);
  fs.chmodSync(fakeFirebase, 0o700);

  const baseConfig = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
  baseConfig.hosting.public = sourcePublic;
  const releaseConfig = createReleaseConfig({ baseConfig, originTrialToken: syntheticOriginTrialToken });
  const artifactManifest = createHostingArtifactManifest(sourcePublic);

  const originals = setTemporaryEnvironment({
    READMATE_FAKE_FIREBASE_CAPTURE: capturePath,
    [originTrialEnvironmentName]: syntheticOriginTrialToken,
    [artifactShaEnvironmentName]: artifactManifest.sha256,
    [expectedApiOriginEnvironmentName]: stableApiOrigin,
    [releaseModeEnvironmentName]: "production",
    [siteIdEnvironmentName]: approvedSiteId
  });
  try {
    deployFirebaseRelease(
      {
        expectedApiOrigin: stableApiOrigin,
        expectedArtifactSha256: artifactManifest.sha256,
        firebaserc: createFirebaserc(approvedSiteId),
        releaseConfig,
        releaseMode: "production"
      },
      { firebaseCli: fakeFirebase }
    );
  } finally {
    restoreTemporaryEnvironment(originals);
  }

  const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
  assert.deepEqual(capture.argv, [
    "deploy",
    "--non-interactive",
    "--project",
    firebaseProjectId,
    "--config",
    "firebase.web.release.json",
    "--only",
    "hosting:readmate-web"
  ]);
  assert.deepEqual(capture.releaseEnvironment, {});
  assert.equal(capture.config.hosting.public, "public");
  assert.equal(capture.config.hosting.target, "readmate-web");
  assert.equal(Object.prototype.hasOwnProperty.call(capture.config.hosting, "site"), false);
  assert.deepEqual(
    capture.config.hosting.headers[0].headers.filter((header) => header.key === "Origin-Trial"),
    [{ key: "Origin-Trial", value: syntheticOriginTrialToken }]
  );
  assert.deepEqual(capture.firebaserc, createFirebaserc(approvedSiteId));
  assert.equal(capture.publicBody, "readmate");
  assert.equal(fs.existsSync(capture.cwd), false, "temporary release directory should be removed");
});

function createApiArtifact(t, apiOrigin, prefix) {
  const root = createTemporaryDirectory(t, `readmate-api-origin-${prefix}`);
  write(path.join(root, "assets/app.js"), `const apiBaseUrl = ${JSON.stringify(apiOrigin)};`);
  return root;
}

function createTemporaryDirectory(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createFirebaserc(siteId) {
  return {
    projects: { readmateRelease: firebaseProjectId },
    targets: {
      [firebaseProjectId]: {
        hosting: { "readmate-web": [siteId] }
      }
    }
  };
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function setTemporaryEnvironment(values) {
  const originals = new Map();
  for (const [name, value] of Object.entries(values)) {
    originals.set(name, process.env[name]);
    process.env[name] = value;
  }
  return originals;
}

function restoreTemporaryEnvironment(originals) {
  for (const [name, value] of originals) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
