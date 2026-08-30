const fs = require("node:fs");
const path = require("node:path");

if (process.env.EAS_BUILD_PLATFORM && process.env.EAS_BUILD_PLATFORM !== "ios") {
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, "..");
const moduleRoot = path.join(projectRoot, "modules", "readmate-airplay");
const scenePluginPath = path.join(projectRoot, "plugins", "with-ios-scene-lifecycle.js");
const extensionVersionPluginPath = path.join(projectRoot, "plugins", "with-ios-extension-version-sync.js");
const appDelegatePath = path.join(projectRoot, "ios", "ReadMateAI", "AppDelegate.swift");
const infoPlistPath = path.join(projectRoot, "ios", "ReadMateAI", "Info.plist");
const xcodeProjectPath = path.join(projectRoot, "ios", "ReadMateAI.xcodeproj", "project.pbxproj");
const requiredFiles = [
  path.join(moduleRoot, "expo-module.config.json"),
  path.join(moduleRoot, "ios", "ReadMateAirPlay.podspec"),
  path.join(moduleRoot, "ios", "ReadMateAirPlayModule.swift"),
  scenePluginPath,
  extensionVersionPluginPath
];
const missingFiles = requiredFiles.filter((file) => !fs.existsSync(file));

if (missingFiles.length > 0) {
  const relativeFiles = missingFiles.map((file) => path.relative(projectRoot, file));
  throw new Error(
    `The iOS release package is missing required ReadMateAirPlay sources: ${relativeFiles.join(", ")}. ` +
      "Do not exclude every directory named ios when staging the app."
  );
}

const config = JSON.parse(fs.readFileSync(requiredFiles[0], "utf8"));
const appleModules = config.apple?.modules ?? [];
if (!config.platforms?.includes("apple") || !appleModules.includes("ReadMateAirPlayModule")) {
  throw new Error("ReadMateAirPlay must declare the apple platform and ReadMateAirPlayModule for Expo autolinking.");
}

const appJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "app.json"), "utf8"));
if (!appJson.expo?.plugins?.includes("./plugins/with-ios-scene-lifecycle")) {
  throw new Error("The iOS scene lifecycle config plugin must remain enabled for regenerated native projects.");
}
if (!appJson.expo?.plugins?.includes("./plugins/with-ios-extension-version-sync")) {
  throw new Error("The iOS extension build-number sync plugin must remain enabled for regenerated native projects.");
}

const sceneChecks = [
  [scenePluginPath, ["withAppDelegate", "withInfoPlist", "UIApplicationSceneManifest"]],
  [extensionVersionPluginPath, ["APPLICATION_EXTENSION_API_ONLY", "CURRENT_PROJECT_VERSION"]]
];

const iosProjectRoot = path.join(projectRoot, "ios");
if (fs.existsSync(iosProjectRoot)) {
  const generatedNativeFiles = [appDelegatePath, infoPlistPath, xcodeProjectPath];
  const missingNativeFiles = generatedNativeFiles.filter((file) => !fs.existsSync(file));
  if (missingNativeFiles.length > 0) {
    throw new Error(
      `The generated iOS project is incomplete: ${missingNativeFiles.map((file) => path.relative(projectRoot, file)).join(", ")}.`
    );
  }
  sceneChecks.push(
    [appDelegatePath, ["class SceneDelegate", "UIWindowSceneDelegate", "UIWindow(windowScene: windowScene)"]],
    [infoPlistPath, ["UIApplicationSceneManifest", "UISceneDelegateClassName", "$(PRODUCT_MODULE_NAME).SceneDelegate"]]
  );
}

for (const [file, patterns] of sceneChecks) {
  const source = fs.readFileSync(file, "utf8");
  const missing = patterns.filter((pattern) => !source.includes(pattern));
  if (missing.length) {
    throw new Error(`${path.relative(projectRoot, file)} is missing iOS scene lifecycle markers: ${missing.join(", ")}`);
  }
}

if (fs.existsSync(xcodeProjectPath)) {
  const xcodeProject = fs.readFileSync(xcodeProjectPath, "utf8");
  if (/APPLICATION_EXTENSION_API_ONLY = YES;[\s\S]{0,500}CURRENT_PROJECT_VERSION = 1;/.test(xcodeProject)) {
    throw new Error("The widget extension build number must match the containing ReadMate app build number.");
  }
}

console.log("Validated ReadMateAirPlay, iOS scene lifecycle, and extension build-number sync.");
