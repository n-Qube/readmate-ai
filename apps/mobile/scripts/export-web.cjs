#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProjectEnv } = require("@expo/env");
const { validateWebDeployment } = require("./validate-web-deployment.cjs");

const mobileRoot = path.resolve(__dirname, "..");
const exportDir = path.join(mobileRoot, "dist");
const expoCli = require.resolve("expo/bin/cli", { paths: [mobileRoot] });
process.env.NODE_ENV = process.env.NODE_ENV || "production";
loadProjectEnv(mobileRoot, { mode: "production", silent: true });
const env = {
  ...process.env,
  APP_VARIANT: process.env.APP_VARIANT || "production",
  READMATE_WEB_EXPORT: "1"
};

runExpo(["config", "--type", "public", "--json"]);
validateWebDeployment({ env, requireProductionEnvironment: true });
runExpo(["export", "--platform", "web", "--output-dir", exportDir, "--clear"]);
validateWebDeployment({ env, exportDir, requireProductionEnvironment: true });

console.log(`Production web export validated at ${exportDir}. No deployment was performed.`);

function runExpo(args) {
  const result = spawnSync(process.execPath, [expoCli, ...args], {
    cwd: mobileRoot,
    env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
