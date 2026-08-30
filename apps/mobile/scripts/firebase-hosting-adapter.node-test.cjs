const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  prepareFirebaseHosting
} = require("./prepare-firebase-hosting.cjs");
const {
  defaultConfigPath,
  validateFirebaseConfig,
  validateFirebaseHosting
} = require("./validate-firebase-hosting.cjs");
const { requiredHeaders } = require("./validate-web-deployment.cjs");

test("merges Expo client assets and server HTML into safe Firebase routes", (t) => {
  const fixture = createFixture(t);
  const staleFile = path.join(fixture.outputDir, "stale.html");
  write(staleFile, "stale");

  const result = prepareFirebaseHosting({
    exportDir: fixture.exportDir,
    outputDir: fixture.outputDir,
    env: {}
  });

  assert.equal(result.outputDir, fixture.outputDir);
  assert.equal(read(path.join(fixture.outputDir, "_expo/static/js/app.js")), "client-js");
  assert.equal(read(path.join(fixture.outputDir, "assets/logo.png")), "client-asset");
  assert.equal(read(path.join(fixture.outputDir, "challenge.html")), "challenge-landing-page");
  assert.equal(read(path.join(fixture.outputDir, "challenge-demo.html")), "challenge-demo-article");
  assert.equal(read(path.join(fixture.outputDir, "challenge-feed.xml")), "challenge-atom-feed");
  assert.equal(read(path.join(fixture.outputDir, "index.html")), "root");
  assert.equal(read(path.join(fixture.outputDir, "library.html")), "library");
  assert.equal(read(path.join(fixture.outputDir, "history.html")), "history");
  assert.equal(read(path.join(fixture.outputDir, "study.html")), "study");
  assert.equal(read(path.join(fixture.outputDir, "more.html")), "more");
  assert.equal(read(path.join(fixture.outputDir, "about.html")), "about");
  assert.equal(read(path.join(fixture.outputDir, "_firebase_routes/document.html")), "document");
  assert.equal(read(path.join(fixture.outputDir, "404.html")), "not-found");
  assert.equal(fs.existsSync(staleFile), false);

  assert.doesNotThrow(() => validateFirebaseHosting({
    exportDir: fixture.exportDir,
    outputDir: fixture.outputDir,
    configPath: defaultConfigPath,
    env: {}
  }));
});

test("rejects two Expo pages that would overwrite one friendly route with different HTML", (t) => {
  const fixture = createFixture(t);
  const priorOutput = path.join(fixture.outputDir, "last-known-good.html");
  write(priorOutput, "last-known-good");
  write(path.join(fixture.exportDir, "server/index.html"), "conflicting-root");

  assert.throws(
    () => prepareFirebaseHosting({ exportDir: fixture.exportDir, outputDir: fixture.outputDir, env: {} }),
    /Conflicting Expo artifacts/
  );
  assert.equal(read(priorOutput), "last-known-good");
});

test("rejects Expo API routes instead of silently dropping server behavior", (t) => {
  const fixture = createFixture(t);
  const priorOutput = path.join(fixture.outputDir, "last-known-good.html");
  write(priorOutput, "last-known-good");
  const manifestPath = path.join(fixture.exportDir, "server/_expo/routes.json");
  const manifest = JSON.parse(read(manifestPath));
  manifest.apiRoutes.push({ page: "/api/example" });
  write(manifestPath, JSON.stringify(manifest));

  assert.throws(
    () => prepareFirebaseHosting({ exportDir: fixture.exportDir, outputDir: fixture.outputDir, env: {} }),
    /cannot package Expo API routes/
  );
  assert.equal(read(priorOutput), "last-known-good");
});

test("refuses output paths outside the one generated Firebase directory", (t) => {
  const fixture = createFixture(t);

  assert.throws(
    () => prepareFirebaseHosting({
      exportDir: fixture.exportDir,
      outputDir: path.join(fixture.exportDir, "client", "firebase-hosting"),
      env: {}
    }),
    /must be exactly the generated firebase-hosting directory/
  );
});

test("rejects a symlinked Expo export root before touching its generated output", (t) => {
  const fixture = createFixture(t);
  const linkedExport = path.join(path.dirname(fixture.exportDir), "linked-dist");
  fs.symlinkSync(fixture.exportDir, linkedExport, "dir");
  const priorOutput = path.join(fixture.outputDir, "last-known-good.html");
  write(priorOutput, "last-known-good");

  assert.throws(
    () => prepareFirebaseHosting({
      exportDir: linkedExport,
      outputDir: path.join(linkedExport, "firebase-hosting"),
      env: {}
    }),
    /Expo export root not found/
  );
  assert.equal(read(priorOutput), "last-known-good");
});

test("rejects route HTML reached through a symlinked export directory", (t) => {
  const fixture = createFixture(t);
  const documentDir = path.join(fixture.exportDir, "server/document");
  const outsideDir = path.join(path.dirname(fixture.exportDir), "outside-document");
  fs.renameSync(documentDir, outsideDir);
  fs.symlinkSync(outsideDir, documentDir, "dir");

  assert.throws(
    () => prepareFirebaseHosting({ exportDir: fixture.exportDir, outputDir: fixture.outputDir, env: {} }),
    /route HTML is missing/
  );
});

test("Firebase config requires an explicit ReadMate target and forbids catch-all rewrites", () => {
  const config = JSON.parse(read(defaultConfigPath));
  const validFailures = [];
  validateFirebaseConfig(config, validFailures);
  assert.deepEqual(validFailures, []);
  assert.deepEqual(config.hosting.rewrites, [{
    source: "/document/*",
    destination: "/_firebase_routes/document.html"
  }]);

  delete config.hosting.target;
  config.hosting.rewrites.push({ source: "**", destination: "/index.html" });
  const unsafeFailures = [];
  validateFirebaseConfig(config, unsafeFailures);
  assert.match(unsafeFailures.join("\n"), /explicit target prevents default-site deployment/);
  assert.match(unsafeFailures.join("\n"), /no catch-all rewrite/);
});

test("Firebase config rejects empty deployments, redirects, and unreviewed options", () => {
  const config = JSON.parse(read(defaultConfigPath));
  config.hosting.ignore = ["**"];
  config.hosting.redirects = [{ source: "**", destination: "https://example.invalid", type: 302 }];
  config.hosting.appAssociation = "AUTO";

  const failures = [];
  validateFirebaseConfig(config, failures);
  const message = failures.join("\n");
  assert.match(message, /ignore rules must exactly match/);
  assert.match(message, /cannot define redirects/);
  assert.match(message, /unreviewed keys: redirects, appAssociation/);
});

function createFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "readmate-firebase-adapter-"));
  const exportDir = path.join(fixtureRoot, "dist");
  const outputDir = path.join(exportDir, "firebase-hosting");
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  write(path.join(exportDir, "client/_expo/static/js/app.js"), "client-js");
  write(path.join(exportDir, "client/assets/logo.png"), "client-asset");
  write(path.join(exportDir, "client/challenge.html"), "challenge-landing-page");
  write(path.join(exportDir, "client/challenge-demo.html"), "challenge-demo-article");
  write(path.join(exportDir, "client/challenge-feed.xml"), "challenge-atom-feed");

  const htmlRoutes = [
    route("/(tabs)/index", "root"),
    route("/index", "root"),
    route("/(tabs)/library", "library"),
    route("/(tabs)/history", "history"),
    route("/(tabs)/study", "study"),
    route("/(tabs)/more", "more"),
    route("/about", "about"),
    route("/document/[id]", "document")
  ];
  for (const entry of htmlRoutes) {
    write(path.join(exportDir, "server", `${entry.page.slice(1)}.html`), entry.body);
    delete entry.body;
  }
  write(path.join(exportDir, "server/+not-found.html"), "not-found");
  write(path.join(exportDir, "server/_expo/routes.json"), JSON.stringify({
    apiRoutes: [],
    htmlRoutes,
    notFoundRoutes: [{ page: "/+not-found" }],
    redirects: [],
    rewrites: [],
    headers: requiredHeaders
  }));

  return { exportDir, outputDir };
}

function route(page, body) {
  return { page, body };
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}
