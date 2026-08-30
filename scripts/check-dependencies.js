#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const acceptedHighAdvisories = new Set(["@prisma/config", "deepmerge-ts", "prisma"]);
const audit = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("Dependency audit did not return a valid report.");
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const critical = vulnerabilities.filter((item) => item.severity === "critical").map((item) => item.name);
const unexpectedHigh = vulnerabilities
  .filter((item) => item.severity === "high" && !acceptedHighAdvisories.has(item.name))
  .map((item) => item.name);
const expectedHigh = vulnerabilities
  .filter((item) => item.severity === "high" && acceptedHighAdvisories.has(item.name))
  .map((item) => item.name);

if (critical.length || unexpectedHigh.length) {
  if (critical.length) console.error(`Critical dependency advisories: ${critical.join(", ")}`);
  if (unexpectedHigh.length) console.error(`Unreviewed high dependency advisories: ${unexpectedHigh.join(", ")}`);
  process.exit(1);
}

console.log(
  `Dependency gate passed: 0 critical, ${expectedHigh.length} documented Prisma CLI high, ` +
  `${report.metadata?.vulnerabilities?.moderate ?? 0} upstream moderate.`
);
