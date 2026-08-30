const { withXcodeProject } = require("@expo/config-plugins");

const DISTRIBUTION_IDENTITY = "iPhone Distribution: Daniel Nortey (4KMU385H3M)";

module.exports = function withIosSigningIdentity(config) {
  return withXcodeProject(config, (configWithProject) => {
    const project = configWithProject.modResults;

    for (const section of Object.values(project.pbxXCBuildConfigurationSection())) {
      if (!section || typeof section !== "object" || !section.buildSettings) {
        continue;
      }

      for (const [key, value] of Object.entries(section.buildSettings)) {
        if (key.startsWith("CODE_SIGN_IDENTITY") && value === "Apple Distribution") {
          section.buildSettings[key] = DISTRIBUTION_IDENTITY;
        }
      }
    }

    return configWithProject;
  });
};
