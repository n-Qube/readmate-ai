const variants = {
  development: {
    name: "ReadMate Dev",
    iosBundleIdentifier: "ai.readmate.mobile.dev",
    androidPackage: "ai.readmate.mobile.dev"
  },
  preview: {
    name: "ReadMate Preview",
    iosBundleIdentifier: "ai.readmate.mobile.preview",
    androidPackage: "ai.readmate.mobile.preview"
  },
  production: {
    name: "ReadMate",
    iosBundleIdentifier: "ai.readmate.mobile",
    androidPackage: "ai.readmate.mobile"
  }
};

const {
  assertSafePublicEnvironment,
  parseExactHttpsOrigin
} = require("./scripts/public-env-contract.cjs");

module.exports = ({ config }) => {
  const variantName = process.env.APP_VARIANT || "production";
  const variant = variants[variantName];
  const omitWidgetExtension = process.env.READMATE_DEVICE_BUILD_NO_WIDGET === "1";
  const isNativeRelease = process.env.READMATE_RELEASE_BUILD === "1";
  const isProductionWebExport = process.env.READMATE_WEB_EXPORT === "1";
  if (!variant) {
    throw new Error(`Unknown APP_VARIANT: ${variantName}`);
  }
  if (isNativeRelease || isProductionWebExport) {
    const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
    const apiUrl = process.env.EXPO_PUBLIC_READMATE_API_URL || "";
    if (variantName !== "production") throw new Error("Release builds must use APP_VARIANT=production.");
    assertSafePublicEnvironment(process.env, { production: true });
    if (!isProductionClerkPublishableKey(clerkKey)) {
      throw new Error("Release builds require a valid Clerk production publishable key.");
    }
    if (!apiUrl.startsWith("https://")) throw new Error("Release builds require an HTTPS ReadMate API URL.");
    if (/accounts\.dev|localhost|127\.0\.0\.1/i.test(`${clerkKey} ${apiUrl}`)) {
      throw new Error("Release builds cannot target development identity or API hosts.");
    }

    if (isProductionWebExport) {
      const apiOrigin = parseExactHttpsOrigin("EXPO_PUBLIC_READMATE_API_URL", apiUrl);
      const webOrigin = parseExactHttpsOrigin("WEB_APP_ORIGIN", process.env.WEB_APP_ORIGIN);
      if (apiOrigin === webOrigin) {
        throw new Error("WEB_APP_ORIGIN must be separate from the API origin.");
      }
    }
  }

  if (isNativeRelease) {
    const revenueCatAppleKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY || "";
    const revenueCatGoogleKey = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY || "";
    if (!isRevenueCatSdkKey(revenueCatAppleKey, "appl_")) {
      throw new Error("Release builds require EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY from the ReadMate RevenueCat app.");
    }
    if (!isRevenueCatSdkKey(revenueCatGoogleKey, "goog_")) {
      throw new Error("Release builds require EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY from the ReadMate RevenueCat app.");
    }
  }

  return {
    ...config,
    name: variant.name,
    plugins: omitWidgetExtension
      ? (config.plugins || []).filter((plugin) => {
          const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
          return pluginName !== "expo-widgets" && pluginName !== "./plugins/with-ios-extension-version-sync";
        })
      : config.plugins,
    ios: {
      ...config.ios,
      bundleIdentifier: variant.iosBundleIdentifier
    },
    android: {
      ...config.android,
      package: variant.androidPackage
    }
  };
};

function isProductionClerkPublishableKey(value) {
  const match = /^pk_live_([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return false;

  try {
    const frontendApi = Buffer.from(match[1], "base64url").toString("utf8");
    return frontendApi.endsWith("$") && !frontendApi.endsWith(".clerk.accounts.dev$");
  } catch {
    return false;
  }
}

function isRevenueCatSdkKey(value, prefix) {
  return value.startsWith(prefix) && value.length > prefix.length + 8 && !/replace|example|your[_-]/i.test(value);
}
