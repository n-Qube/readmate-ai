const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(mobileRoot, "../..");
const failures = [];

const appJson = readJson(path.join(mobileRoot, "app.json"));
expectEqual("app.json expo.name", appJson.expo?.name, "ReadMate");

const previousVariant = process.env.APP_VARIANT;
process.env.APP_VARIANT = "production";
const appConfig = require(path.join(mobileRoot, "app.config.js"))({ config: appJson.expo });
if (previousVariant === undefined) delete process.env.APP_VARIANT;
else process.env.APP_VARIANT = previousVariant;
expectEqual("production app.config name", appConfig.name, "ReadMate");

expectMatchIfPresent(
  "iOS display name",
  "ios/ReadMateAI/Info.plist",
  /<key>CFBundleDisplayName<\/key>\s*<string>ReadMate<\/string>/
);
expectMatchIfPresent(
  "Android display name",
  "android/app/src/main/res/values/strings.xml",
  /<string name="app_name">ReadMate<\/string>/
);

const mobileDesign = read("src/components/mobile-design.tsx");
expectMatch("mobile wordmark", mobileDesign, />\s*ReadMate\s*<\/Text>/);
expectMatch("mobile lockup icon", mobileDesign, /function BrandLockup[\s\S]*?<BrandMark/);
expectMatch("mobile lockup wordmark", mobileDesign, /function BrandLockup[\s\S]*?<BrandWordmark/);

const extensionRoot = path.join(workspaceRoot, "apps/extension");
const extensionManifestPath = path.join(extensionRoot, "public/manifest.json");
if (fs.existsSync(extensionManifestPath)) {
  const extensionManifest = readJson(extensionManifestPath);
  expectEqual("Chrome extension name", extensionManifest.name, "ReadMate");
  expectEqual("Chrome toolbar title", extensionManifest.action?.default_title, "ReadMate");
  expectMatch(
    "Chrome extension logo source",
    fs.readFileSync(path.join(extensionRoot, "src/shared/ReadMateLogo.tsx"), "utf8"),
    /icons\/icon-128\.png/
  );
  expectMatch("Chrome side-panel title", fs.readFileSync(path.join(extensionRoot, "sidepanel.html"), "utf8"), /<title>ReadMate<\/title>/);
  expectMatch("Chrome popup title", fs.readFileSync(path.join(extensionRoot, "popup.html"), "utf8"), /<title>ReadMate<\/title>/);
}

if (!fs.existsSync(path.join(mobileRoot, "assets/icon.png"))) failures.push("mobile icon is missing");
if (fs.existsSync(extensionRoot) && !fs.existsSync(path.join(extensionRoot, "public/icons/icon-128.png"))) {
  failures.push("Chrome extension icon is missing");
}

for (const relativeFile of [
  "src/components/mobile-design.tsx",
  "src/components/onboarding-screen.tsx",
  "src/components/sign-in-screen.tsx",
  "src/components/setup-flow.tsx"
]) {
  if (/ReadMate AI/.test(read(relativeFile))) failures.push(`${relativeFile} still exposes the retired ReadMate AI name`);
}

if (failures.length) {
  console.error("Brand consistency validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Brand consistency validation passed: ReadMate name and canonical icon lockups are aligned across mobile and Chrome.");

function read(relativeFile) {
  return fs.readFileSync(path.join(mobileRoot, relativeFile), "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) failures.push(`${label} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
}

function expectMatch(label, source, pattern) {
  if (!pattern.test(source)) failures.push(`${label} does not match the ReadMate brand contract`);
}

function expectMatchIfPresent(label, relativeFile, pattern) {
  const file = path.join(mobileRoot, relativeFile);
  // EAS managed builds exclude generated native folders and regenerate them
  // after the pre-install hook. app.json/app.config remain the source of truth
  // in that staging mode; repository builds still validate native output.
  if (!fs.existsSync(file)) return;
  expectMatch(label, fs.readFileSync(file, "utf8"), pattern);
}
