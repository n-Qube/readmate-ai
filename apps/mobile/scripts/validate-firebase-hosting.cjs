#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  defaultExportDir,
  defaultOutputDir,
  dynamicRouteAdapters,
  normalizeExpoPage,
  readRouteManifest,
  resolveServerHtml,
  requiredFriendlyRoutes,
  assertStaticRouteManifest
} = require("./prepare-firebase-hosting.cjs");
const { requiredHeaders, validateWebDeployment } = require("./validate-web-deployment.cjs");

const mobileRoot = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(mobileRoot, "firebase.web.json");
const firebaseTarget = "readmate-web";
const firebasePublicDirectory = "dist/firebase-hosting";
const firebaseHostingKeys = Object.freeze([
  "target",
  "public",
  "ignore",
  "cleanUrls",
  "trailingSlash",
  "headers",
  "rewrites"
]);
const firebaseIgnoreRules = Object.freeze([
  "firebase.web.json",
  "**/.*",
  "**/node_modules/**"
]);

function validateFirebaseHosting({
  exportDir = defaultExportDir,
  outputDir = defaultOutputDir,
  configPath = defaultConfigPath,
  env = process.env
} = {}) {
  const failures = [];
  const exportRoot = path.resolve(exportDir);
  const hostingRoot = path.resolve(outputDir);

  try {
    validateWebDeployment({ env, exportDir: exportRoot });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const config = readJson(configPath, "Firebase Hosting config", failures);
  if (config) validateFirebaseConfig(config, failures);
  validateGeneratedOutput(exportRoot, hostingRoot, failures, config);

  if (failures.length) {
    const error = new Error(`Firebase Hosting adapter validation failed:\n- ${failures.join("\n- ")}`);
    error.failures = failures;
    throw error;
  }

  return { exportDir: exportRoot, outputDir: hostingRoot, configPath: path.resolve(configPath) };
}

function validateFirebaseConfig(config, failures) {
  const topLevelKeys = Object.keys(config);
  if (topLevelKeys.length !== 1 || topLevelKeys[0] !== "hosting") {
    failures.push("firebase.web.json must contain only the isolated Hosting configuration");
  }

  const hosting = config.hosting;
  if (!hosting || Array.isArray(hosting) || typeof hosting !== "object") {
    failures.push("firebase.web.json must define one Hosting target object");
    return;
  }
  const unexpectedHostingKeys = Object.keys(hosting).filter((key) => !firebaseHostingKeys.includes(key));
  if (unexpectedHostingKeys.length) {
    failures.push(`Firebase Hosting config contains unreviewed keys: ${unexpectedHostingKeys.join(", ")}`);
  }
  if (hosting.target !== firebaseTarget) {
    failures.push(`Firebase Hosting target must be ${firebaseTarget}; an explicit target prevents default-site deployment`);
  }
  if (Object.prototype.hasOwnProperty.call(hosting, "site")) {
    failures.push("Firebase Hosting config must use a deploy target, never a direct or default site");
  }
  if (hosting.public !== firebasePublicDirectory) {
    failures.push(`Firebase Hosting public directory must be ${firebasePublicDirectory}`);
  }
  if (JSON.stringify(hosting.ignore) !== JSON.stringify(firebaseIgnoreRules)) {
    failures.push("Firebase Hosting ignore rules must exactly match the reviewed non-empty deployment contract");
  }
  if (hosting.cleanUrls !== true) failures.push("Firebase Hosting cleanUrls must be true");
  if (hosting.trailingSlash !== false) failures.push("Firebase Hosting trailingSlash must be false");

  if (!Array.isArray(hosting.headers) || hosting.headers.length !== 1) {
    failures.push("Firebase Hosting must contain exactly one reviewed global header rule");
  }
  const globalHeaderRule = (hosting.headers ?? []).find((rule) => rule?.source === "**");
  const configuredHeaders = new Map(
    (globalHeaderRule?.headers ?? []).map((header) => [header?.key, header?.value])
  );
  for (const [name, value] of Object.entries(requiredHeaders)) {
    if (configuredHeaders.get(name) !== value) {
      failures.push(`Firebase Hosting header ${name} must equal ${JSON.stringify(value)} for source **`);
    }
  }
  if (configuredHeaders.size !== Object.keys(requiredHeaders).length) {
    failures.push("Firebase Hosting global headers must contain only the reviewed response headers");
  }

  const expectedRewrites = Object.values(dynamicRouteAdapters);
  const configuredRewrites = hosting.rewrites ?? [];
  if (configuredRewrites.length !== expectedRewrites.length) {
    failures.push("Firebase Hosting must contain only the reviewed document-route rewrite and no catch-all rewrite");
  }
  for (const expected of expectedRewrites) {
    const match = configuredRewrites.find(
      (rewrite) => rewrite?.source === expected.source && rewrite?.destination === expected.destination
    );
    if (!match) failures.push(`Firebase Hosting rewrite ${expected.source} -> ${expected.destination} is required`);
  }
  for (const rewrite of configuredRewrites) {
    if (rewrite?.run || rewrite?.function || rewrite?.dynamicLinks) {
      failures.push("Firebase web adapter cannot deploy or invoke Cloud Run, Functions, or Dynamic Links");
    }
    if (rewrite?.source === "**" || rewrite?.source === "/**") {
      failures.push("Firebase web adapter cannot use a catch-all rewrite because unknown routes must remain 404 responses");
    }
  }
  if (Object.prototype.hasOwnProperty.call(hosting, "redirects")) {
    failures.push("Firebase web adapter cannot define redirects");
  }
}

function validateGeneratedOutput(exportRoot, hostingRoot, failures, config) {
  const clientRoot = path.join(exportRoot, "client");
  const serverRoot = path.join(exportRoot, "server");
  if (!isDirectory(hostingRoot)) {
    failures.push(`generated Firebase Hosting directory is missing: ${hostingRoot}`);
    return;
  }
  if (!isDirectory(clientRoot) || !isDirectory(serverRoot)) {
    failures.push("Expo export must contain both client and server directories");
    return;
  }

  const expectedFiles = new Set();
  for (const sourceFile of walkFiles(clientRoot, failures)) {
    const relative = path.relative(clientRoot, sourceFile);
    expectedFiles.add(relative);
    compareFiles(sourceFile, path.join(hostingRoot, relative), `client asset ${toPosix(relative)}`, failures);
  }

  let routeManifest;
  try {
    routeManifest = readRouteManifest(exportRoot);
    assertStaticRouteManifest(routeManifest);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return;
  }

  const globalHeaderRule = (config?.hosting?.headers ?? []).find((rule) => rule?.source === "**");
  const configuredHeaders = Object.fromEntries(
    (globalHeaderRule?.headers ?? []).map((header) => [header?.key, header?.value])
  );
  if (!sameStringMap(configuredHeaders, routeManifest.headers ?? {})) {
    failures.push("Firebase Hosting response headers must exactly match the Expo route manifest");
  }

  const observedRoutes = new Set();
  for (const route of routeManifest.htmlRoutes ?? []) {
    let publicRoute;
    try {
      publicRoute = normalizeExpoPage(route.page);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    observedRoutes.add(publicRoute);

    let sourceFile;
    try {
      sourceFile = resolveServerHtml(serverRoot, route.page);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const dynamicAdapter = dynamicRouteAdapters[publicRoute];
    let destinationRelative;
    if (hasDynamicSegment(publicRoute)) {
      if (!dynamicAdapter) {
        failures.push(`unsupported dynamic Expo route ${publicRoute}`);
        continue;
      }
      destinationRelative = stripLeadingSlash(dynamicAdapter.destination);
    } else {
      destinationRelative = publicRoute === "/" ? "index.html" : `${stripLeadingSlash(publicRoute)}.html`;
    }
    expectedFiles.add(destinationRelative);
    compareFiles(sourceFile, path.join(hostingRoot, destinationRelative), `route ${publicRoute}`, failures);
  }

  for (const route of requiredFriendlyRoutes) {
    if (!observedRoutes.has(route)) failures.push(`generated adapter is missing friendly route ${route}`);
  }

  const notFoundRoute = (routeManifest.notFoundRoutes ?? [])[0];
  if (!notFoundRoute?.page) {
    failures.push("Expo route manifest is missing a not-found route");
  } else {
    expectedFiles.add("404.html");
    try {
      compareFiles(
        resolveServerHtml(serverRoot, notFoundRoute.page),
        path.join(hostingRoot, "404.html"),
        "custom 404 page",
        failures
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const outputFile of walkFiles(hostingRoot, failures)) {
    const relative = path.relative(hostingRoot, outputFile);
    if (!expectedFiles.has(relative)) {
      failures.push(`generated Firebase Hosting directory contains unexpected file ${toPosix(relative)}`);
    }
  }
}

function readJson(file, label, failures) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function compareFiles(expected, actual, label, failures) {
  if (!isRegularFile(expected)) {
    failures.push(`${label} source is missing: ${expected}`);
    return;
  }
  if (!isRegularFile(actual)) {
    failures.push(`${label} is missing from generated Firebase Hosting output: ${actual}`);
    return;
  }
  if (!fs.readFileSync(expected).equals(fs.readFileSync(actual))) {
    failures.push(`${label} differs from the validated Expo export`);
  }
}

function walkFiles(directory, failures, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      failures.push(`symlink is not allowed in hosting artifacts: ${entryPath}`);
    } else if (entry.isDirectory()) {
      walkFiles(entryPath, failures, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
    } else {
      failures.push(`unsupported hosting artifact: ${entryPath}`);
    }
  }
  return files;
}

function isDirectory(directory) {
  return fs.existsSync(directory) && !fs.lstatSync(directory).isSymbolicLink() && fs.statSync(directory).isDirectory();
}

function isRegularFile(file) {
  return fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile();
}

function sameStringMap(left, right) {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function hasDynamicSegment(route) {
  return /\[[^/\]]+\]/.test(route);
}

function stripLeadingSlash(value) {
  return value.replace(/^\/+/, "");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

if (require.main === module) {
  try {
    const result = validateFirebaseHosting();
    console.log(`Firebase Hosting adapter validation passed at ${result.outputDir}. No deployment was performed.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  defaultConfigPath,
  firebasePublicDirectory,
  firebaseHostingKeys,
  firebaseIgnoreRules,
  firebaseTarget,
  validateFirebaseConfig,
  validateFirebaseHosting
};
