#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { validateWebDeployment } = require("./validate-web-deployment.cjs");

const mobileRoot = path.resolve(__dirname, "..");
const defaultExportDir = path.join(mobileRoot, "dist");
const defaultOutputDir = path.join(defaultExportDir, "firebase-hosting");
const routeManifestRelativePath = path.join("server", "_expo", "routes.json");
const dynamicRouteAdapters = Object.freeze({
  "/document/[id]": Object.freeze({
    source: "/document/*",
    destination: "/_firebase_routes/document.html"
  })
});
const requiredFriendlyRoutes = Object.freeze([
  "/",
  "/library",
  "/history",
  "/study",
  "/more"
]);

function prepareFirebaseHosting({
  exportDir = defaultExportDir,
  outputDir = path.join(path.resolve(exportDir), "firebase-hosting"),
  env = process.env
} = {}) {
  const exportRoot = path.resolve(exportDir);
  const hostingRoot = path.resolve(outputDir);
  const clientRoot = path.join(exportRoot, "client");
  const serverRoot = path.join(exportRoot, "server");

  assertDirectory(exportRoot, "Expo export root");
  assertGeneratedOutputPath(exportRoot, hostingRoot);
  validateWebDeployment({ env, exportDir: exportRoot });

  assertDirectory(clientRoot, "Expo client export");
  assertDirectory(serverRoot, "Expo server export");

  const routeManifest = readRouteManifest(exportRoot);
  assertStaticRouteManifest(routeManifest);
  const stagingRoot = fs.mkdtempSync(path.join(exportRoot, ".firebase-hosting-staging-"));

  try {
    copyTree(clientRoot, stagingRoot);

    const copiedRoutes = new Map();
    for (const route of routeManifest.htmlRoutes ?? []) {
      const publicRoute = normalizeExpoPage(route.page);
      const sourceFile = resolveServerHtml(serverRoot, route.page);
      const dynamicAdapter = dynamicRouteAdapters[publicRoute];

      if (hasDynamicSegment(publicRoute)) {
        if (!dynamicAdapter) {
          throw new Error(`Firebase Hosting adapter has no safe rewrite for dynamic Expo route ${publicRoute}.`);
        }
        copyHtmlRoute(sourceFile, path.join(stagingRoot, stripLeadingSlash(dynamicAdapter.destination)));
        copiedRoutes.set(publicRoute, dynamicAdapter.destination);
        continue;
      }

      const destination = publicRoute === "/"
        ? "index.html"
        : `${stripLeadingSlash(publicRoute)}.html`;
      copyHtmlRoute(sourceFile, path.join(stagingRoot, destination));
      copiedRoutes.set(publicRoute, `/${toPosix(destination)}`);
    }

    for (const route of requiredFriendlyRoutes) {
      if (!copiedRoutes.has(route)) {
        throw new Error(`Expo export is missing required friendly route ${route}.`);
      }
    }

    const notFoundRoute = routeManifest.notFoundRoutes[0];
    if (!notFoundRoute?.page) {
      throw new Error("Expo export is missing a not-found route.");
    }
    copyHtmlRoute(
      resolveServerHtml(serverRoot, notFoundRoute.page),
      path.join(stagingRoot, "404.html")
    );

    installGeneratedDirectory(stagingRoot, hostingRoot);

    return {
      exportDir: exportRoot,
      outputDir: hostingRoot,
      copiedRoutes
    };
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function assertStaticRouteManifest(routeManifest) {
  if ((routeManifest.apiRoutes ?? []).length) {
    throw new Error("Firebase static adapter cannot package Expo API routes.");
  }
  if ((routeManifest.redirects ?? []).length || (routeManifest.rewrites ?? []).length) {
    throw new Error("Firebase static adapter cannot silently replace Expo redirects or rewrites.");
  }
  if (!Array.isArray(routeManifest.notFoundRoutes) || routeManifest.notFoundRoutes.length !== 1) {
    throw new Error("Firebase static adapter requires exactly one Expo not-found route.");
  }
}

function readRouteManifest(exportRoot) {
  const manifestPath = path.join(exportRoot, routeManifestRelativePath);
  const serverRoot = path.join(exportRoot, "server");
  if (!isSafeRegularFile(serverRoot, manifestPath)) {
    throw new Error(`Expo route manifest not found at ${manifestPath}.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Expo route manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(manifest.htmlRoutes)) {
    throw new Error("Expo route manifest must contain htmlRoutes.");
  }
  return manifest;
}

function normalizeExpoPage(page) {
  if (typeof page !== "string" || !page.startsWith("/")) {
    throw new Error(`Invalid Expo route page: ${JSON.stringify(page)}.`);
  }
  const segments = page
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\([^/]+\)$/.test(segment));
  if (segments.at(-1) === "index") segments.pop();
  return segments.length ? `/${segments.join("/")}` : "/";
}

function resolveServerHtml(serverRoot, page) {
  const relativePage = stripLeadingSlash(page);
  if (!relativePage || relativePage.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Unsafe Expo route page: ${JSON.stringify(page)}.`);
  }
  const candidate = path.resolve(serverRoot, `${relativePage}.html`);
  if (!isWithin(serverRoot, candidate)) {
    throw new Error(`Expo route page escapes the server export: ${JSON.stringify(page)}.`);
  }
  if (!isSafeRegularFile(serverRoot, candidate)) {
    throw new Error(`Expo route HTML is missing for ${page}: ${candidate}.`);
  }
  return candidate;
}

function copyTree(sourceRoot, destinationRoot) {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to package symlink from Expo client export: ${source}.`);
    }
    if (entry.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      copyTree(source, destination);
    } else if (entry.isFile()) {
      copyFileWithoutCollision(source, destination);
    } else {
      throw new Error(`Unsupported entry in Expo client export: ${source}.`);
    }
  }
}

function copyHtmlRoute(source, destination) {
  if (path.extname(source) !== ".html" || path.extname(destination) !== ".html") {
    throw new Error("Firebase route adapter only copies HTML route artifacts.");
  }
  copyFileWithoutCollision(source, destination);
}

function copyFileWithoutCollision(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    const existing = fs.readFileSync(destination);
    const incoming = fs.readFileSync(source);
    if (!existing.equals(incoming)) {
      throw new Error(`Conflicting Expo artifacts would map to ${destination}.`);
    }
    return;
  }
  fs.copyFileSync(source, destination);
}

function assertGeneratedOutputPath(exportRoot, outputRoot) {
  const expectedOutput = path.join(exportRoot, "firebase-hosting");
  if (outputRoot !== expectedOutput) {
    throw new Error("Firebase Hosting output must be exactly the generated firebase-hosting directory at the Expo export root.");
  }
  if (fs.realpathSync(path.dirname(outputRoot)) !== fs.realpathSync(exportRoot)) {
    throw new Error("Firebase Hosting output must stay within the physical Expo export root.");
  }
}

function installGeneratedDirectory(stagingRoot, outputRoot) {
  const backupRoot = path.join(
    path.dirname(outputRoot),
    `.firebase-hosting-backup-${process.pid}-${Date.now()}`
  );
  const hadPreviousOutput = fs.existsSync(outputRoot);

  if (hadPreviousOutput) {
    const outputStat = fs.lstatSync(outputRoot);
    if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
      throw new Error(`Refusing to replace unsafe Firebase Hosting output at ${outputRoot}.`);
    }
    fs.renameSync(outputRoot, backupRoot);
  }

  try {
    fs.renameSync(stagingRoot, outputRoot);
  } catch (error) {
    if (hadPreviousOutput && !fs.existsSync(outputRoot) && fs.existsSync(backupRoot)) {
      fs.renameSync(backupRoot, outputRoot);
    }
    throw error;
  }

  if (hadPreviousOutput) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

function assertDirectory(directory, label) {
  if (
    !fs.existsSync(directory) ||
    fs.lstatSync(directory).isSymbolicLink() ||
    !fs.statSync(directory).isDirectory()
  ) {
    throw new Error(`${label} not found at ${directory}. Run the server-mode Expo web export first.`);
  }
}

function hasDynamicSegment(route) {
  return /\[[^/\]]+\]/.test(route);
}

function stripLeadingSlash(value) {
  return value.replace(/^\/+/, "");
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSafeRegularFile(root, candidate) {
  if (!fs.existsSync(candidate) || !isWithin(root, candidate)) return false;

  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  let cursor = path.resolve(root);
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) return false;
  }
  return fs.statSync(candidate).isFile();
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

if (require.main === module) {
  try {
    const result = prepareFirebaseHosting();
    console.log(`Firebase Hosting adapter prepared at ${result.outputDir}. No deployment was performed.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  defaultExportDir,
  defaultOutputDir,
  dynamicRouteAdapters,
  normalizeExpoPage,
  prepareFirebaseHosting,
  readRouteManifest,
  resolveServerHtml,
  requiredFriendlyRoutes,
  assertStaticRouteManifest
};
