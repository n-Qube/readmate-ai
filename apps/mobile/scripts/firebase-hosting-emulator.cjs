#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const {
  defaultConfigPath,
  firebaseTarget,
  validateFirebaseHosting
} = require("./validate-firebase-hosting.cjs");

const mobileRoot = path.resolve(__dirname, "..");
const demoProjectId = "demo-readmate-hosting";
const demoSiteId = "readmate-hosting-emulator";

async function run() {
  validateFirebaseHosting();
  const port = await reservePort();
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "readmate-firebase-emulator-"));
  try {
    const publicRoot = path.join(stagingRoot, "public");
    copyTreeWithoutLinks(path.join(mobileRoot, "dist/firebase-hosting"), publicRoot);

    const config = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8"));
    config.hosting.public = "public";
    config.emulators = { hosting: { host: "127.0.0.1", port } };
    fs.writeFileSync(
      path.join(stagingRoot, "firebase.web.json"),
      `${JSON.stringify(config, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(stagingRoot, ".firebaserc"),
      `${JSON.stringify({
        projects: { default: demoProjectId },
        targets: {
          [demoProjectId]: { hosting: { [firebaseTarget]: [demoSiteId] } }
        }
      }, null, 2)}\n`
    );

    const contractScript = path.join(__dirname, "firebase-hosting-emulator-contract.cjs");
    const command = `${shellQuote(process.execPath)} ${shellQuote(contractScript)}`;
    const firebaseCli = process.env.FIREBASE_CLI_BIN || "firebase";
    const result = spawnSync(
      firebaseCli,
      [
        "emulators:exec",
        "--only",
        `hosting:${firebaseTarget}`,
        "--project",
        demoProjectId,
        "--config",
        "firebase.web.json",
        command
      ],
      {
        cwd: stagingRoot,
        env: {
          ...process.env,
          CI: "true",
          FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
          READMATE_FIREBASE_EMULATOR_ORIGIN: `http://127.0.0.1:${port}`,
          READMATE_FIREBASE_EMULATOR_PUBLIC: publicRoot
        },
        stdio: "inherit",
        timeout: 120_000,
        killSignal: "SIGTERM"
      }
    );
    if (result.error) throw result.error;
    if (result.signal) {
      throw new Error(`Firebase Hosting emulator contract was terminated by ${result.signal}.`);
    }
    if (result.status !== 0) {
      throw new Error(`Firebase Hosting emulator contract exited with status ${result.status}.`);
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not reserve a local Firebase Hosting emulator port."));
        else resolve(port);
      });
    });
  });
}

function copyTreeWithoutLinks(sourceRoot, destinationRoot) {
  const stat = fs.lstatSync(sourceRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Firebase Hosting emulator source is unsafe: ${sourceRoot}`);
  }
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Firebase emulator refuses symlink: ${source}`);
    if (entry.isDirectory()) copyTreeWithoutLinks(source, destination);
    else if (entry.isFile()) fs.copyFileSync(source, destination);
    else throw new Error(`Firebase emulator refuses unsupported file type: ${source}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
