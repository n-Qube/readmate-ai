import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const finalMode = process.argv.includes("--final");

const requiredFiles = [
  "README.md",
  "CHALLENGE_CHANGELOG.md",
  "CONTRIBUTING.md",
  "JUDGE_TESTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "package-lock.json",
  "docs/firebase-hosting-adapter.md",
  "docs/webmcp-challenge-submission.md",
  "docs/webmcp-demo-runbook.md",
];

const disallowedPatterns = [
  /(^|\/)\.env(?:\.|$)(?!example$)/,
  /(^|\/)\.secrets(?:\/|$)/,
  /(^|\/)\.firebase(?:\/|$)/,
  /(^|\/)firebase-debug(?:\.|$)/,
  /(^|\/)builds(?:\/|$)/,
  /(^|\/)screenshots(?:\/|$)/,
  /(^|\/)store-assets(?:\/|$)/,
  /(^|\/)design-(?:references|audit)(?:\/|$)/,
  /(^|\/)android\/(?:build|\.gradle|\.cxx)(?:\/|$)/,
  /(^|\/)ios\/(?:build|DerivedData|Pods)(?:\/|$)/,
  /\.(?:aab|apk|ipa|xcarchive|mobileprovision|p12|cer|zip|tgz|tar\.gz)$/i,
];

function fail(message) {
  console.error(`Publication readiness failed: ${message}`);
  process.exitCode = 1;
}

for (const path of requiredFiles) {
  if (!existsSync(resolve(root, path))) fail(`missing required public file ${path}`);
}

const listed = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((path) => existsSync(resolve(root, path)));

const disallowed = listed.filter((path) => disallowedPatterns.some((pattern) => pattern.test(path)));
if (disallowed.length > 0) {
  fail(`files that must not be published are eligible:\n${disallowed.map((path) => `  - ${path}`).join("\n")}`);
}

const totalBytes = listed.reduce((sum, path) => sum + statSync(resolve(root, path)).size, 0);
const license = ["LICENSE", "LICENSE.md", "LICENSE.txt"].find((path) => existsSync(resolve(root, path)));
if (!license) {
  const message = "an owner-approved OSI license has not been added at the repository root";
  if (finalMode) fail(message);
  else console.warn(`Publication readiness warning: ${message}.`);
}

const submissionPath = resolve(root, "docs/webmcp-challenge-submission.md");
const submission = readFileSync(submissionPath, "utf8");
const challengeChangelog = readFileSync(resolve(root, "CHALLENGE_CHANGELOG.md"), "utf8");
const judgeTesting = readFileSync(resolve(root, "JUDGE_TESTING.md"), "utf8");
const demoRunbook = readFileSync(resolve(root, "docs/webmcp-demo-runbook.md"), "utf8");
const placeholders = [
  { value: "[LIVE_APP_URL]", source: `${submission}\n${judgeTesting}\n${demoRunbook}` },
  { value: "[PUBLIC_REPOSITORY_URL]", source: `${submission}\n${demoRunbook}` },
  { value: "[PUBLIC_VIDEO_URL]", source: submission },
  { value: "[CHALLENGE_COMMIT_RANGE]", source: challengeChangelog },
]
  .filter(({ value, source }) => source.includes(value))
  .map(({ value }) => value);
if (placeholders.length > 0) {
  const message = `submission placeholders remain: ${placeholders.join(", ")}`;
  if (finalMode) fail(message);
  else console.warn(`Publication readiness warning: ${message}.`);
}

console.log(
  `Publication source set: ${listed.length} files, ${totalBytes} bytes${license ? `, license ${license}` : ""}.`,
);
if (!process.exitCode) {
  console.log(finalMode ? "Final publication readiness check passed." : "Publication preflight passed.");
}
