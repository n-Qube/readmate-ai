const fs = require("node:fs/promises");
const path = require("node:path");
const plist = require("@expo/plist").default;
const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");

module.exports = function withIosExtensionVersionSync(config) {
  const appBuildNumber = String(config.ios?.buildNumber ?? "").trim();
  const appVersion = String(config.version ?? "").trim();

  if (!appBuildNumber || !appVersion) {
    throw new Error("ReadMate requires both an iOS build number and app version for extension version sync.");
  }

  config = withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;
    const configurations = Object.values(project.pbxXCBuildConfigurationSection()).filter(
      (section) => section && typeof section === "object" && section.buildSettings
    );

    for (const section of configurations) {
      if (section.buildSettings.APPLICATION_EXTENSION_API_ONLY === "YES") {
        section.buildSettings.CURRENT_PROJECT_VERSION = appBuildNumber;
        section.buildSettings.MARKETING_VERSION = appVersion;
      }
    }

    return configWithProject;
  });

  return withDangerousMod(config, [
    "ios",
    async (configWithProject) => {
      const extensionInfoPlistPath = path.join(
        configWithProject.modRequest.platformProjectRoot,
        "ExpoWidgetsTarget",
        "Info.plist"
      );
      const extensionInfo = plist.parse(await fs.readFile(extensionInfoPlistPath, "utf8"));
      extensionInfo.CFBundleVersion = appBuildNumber;
      extensionInfo.CFBundleShortVersionString = appVersion;
      await fs.writeFile(extensionInfoPlistPath, plist.build(extensionInfo));
      return configWithProject;
    },
  ]);
};
