#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { PUBLIC_CLIENT_VARIABLE_SET } = require("../apps/mobile/scripts/public-env-contract.cjs");

const root = path.resolve(__dirname, "..");
const workspaceMode = process.argv.includes("--workspace");
const historyMode = process.argv.includes("--history");
const excludedDirectoryNames = new Set([
  ".git",
  ".gradle",
  ".kotlin",
  ".cxx",
  "node_modules",
  "dist",
  "coverage",
  "Pods",
  "DerivedData",
  "build",
  "build-auto",
  "build-device",
  "build-device-release",
  "builds",
  "design-references",
  "screenshots",
  "store-assets",
  ".superpowers"
]);
const binaryExtensions = new Set([
  ".aab", ".apk", ".app", ".cer", ".dSYM", ".gif", ".ico", ".ipa", ".jpeg", ".jpg",
  ".jar", ".jks", ".keystore", ".mobileprovision", ".mp3", ".p12", ".pdf", ".png", ".tar", ".tgz", ".webp", ".xcarchive", ".zip"
]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /\bsk_(?:live|test)_[A-Za-z0-9_-]{16,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bya29\.[0-9A-Za-z_-]{30,}\b/,
  /\b(?:1\/\/|4\/)[0-9A-Za-z_-]{30,}\b/,
  /\b(?:postgres|postgresql):\/\/[^\s:@/]+:[^\s@/]+@/i,
  /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/
];

function normalize(file) {
  return file.split(path.sep).join("/").replace(/^\.\//, "");
}

function isAllowedExample(file) {
  return /(?:^|\/)\.env\.example$/.test(file) || /(?:^|\/)docs\//.test(file);
}

function hasSensitivePath(file) {
  if (isAllowedExample(file)) return false;
  if (isSafeClientEnvironment(file)) return false;
  return /(?:^|\/)\.secrets(?:\/|$)/.test(file) ||
    /(?:^|\/)\.env(?:\.|$)/.test(file) ||
    /(?:^|\/)\.expo\/.*\/logs(?:\/|$)/.test(file);
}

function isSafeClientEnvironment(file) {
  const allowedKeys = file === "apps/mobile/.env"
    ? PUBLIC_CLIENT_VARIABLE_SET
    : file === "apps/extension/.env.local"
      ? new Set([
          "VITE_CLERK_PUBLISHABLE_KEY",
          "VITE_CLERK_SYNC_HOST",
          "VITE_ENABLE_CLERK_UI",
          "VITE_READMATE_API_URL"
        ])
      : null;
  if (!allowedKeys || !fs.existsSync(path.join(root, file))) return false;
  const content = fs.readFileSync(path.join(root, file), "utf8");
  return content.split(/\r?\n/).every((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    const key = trimmed.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
    return Boolean(key && allowedKeys.has(key));
  });
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile()) files.push(normalize(path.relative(root, absolute)));
  }
  return files;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalize);
}

function inspectFile(file) {
  if (!fs.existsSync(path.join(root, file))) return null;
  if (file === "scripts/check-secrets.js") return null;
  if (hasSensitivePath(file)) return "sensitive file path";
  if (binaryExtensions.has(path.extname(file)) || isAllowedExample(file)) return null;
  const absolute = path.join(root, file);
  const stats = fs.statSync(absolute);
  if (stats.size > 2 * 1024 * 1024) return null;
  const content = fs.readFileSync(absolute, "utf8");
  return secretPatterns.some((pattern) => pattern.test(content)) ? "secret-like content" : null;
}

const findings = [];
for (const file of workspaceMode ? walk(root) : trackedFiles()) {
  try {
    const reason = inspectFile(file);
    if (reason) findings.push({ file, reason });
  } catch {
    findings.push({ file, reason: "could not inspect file" });
  }
}

if (historyMode) {
  // Match the tracked-file policy when reading historical patches. Example
  // environment files and documentation may intentionally contain obvious
  // placeholder credentials, so scanning their diff text would make the first
  // public commit fail even though inspectFile deliberately excludes them.
  const history = spawnSync("git", [
    "log",
    "-p",
    "--all",
    "--no-ext-diff",
    "--",
    ".",
    ":(exclude).env.example",
    ":(exclude)**/.env.example",
    ":(exclude)docs/**",
    ":(exclude)**/docs/**",
    ":(exclude)scripts/check-secrets.js"
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (history.error || history.status !== 0) {
    findings.push({ file: "git history", reason: "could not inspect history" });
  } else if (secretPatterns.some((pattern) => pattern.test(history.stdout))) {
    findings.push({ file: "git history", reason: "secret-like content" });
  }
}

if (findings.length) {
  console.error("Secret hygiene check failed. Values are intentionally redacted:");
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.reason}`);
  process.exit(1);
}

console.log(`Secret hygiene check passed (${workspaceMode ? "workspace" : "tracked files"}${historyMode ? " and history" : ""}).`);
