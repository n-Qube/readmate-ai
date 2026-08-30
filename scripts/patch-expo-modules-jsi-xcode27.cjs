const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.join(
  __dirname,
  "..",
  "node_modules",
  "expo-modules-jsi",
  "apple",
);

if (!fs.existsSync(packageRoot)) {
  console.log("[xcode27] expo-modules-jsi is not installed; patch skipped.");
  process.exit(0);
}

function patchFile(relativePath, original, replacement) {
  const filePath = path.join(packageRoot, relativePath);
  const source = fs.readFileSync(filePath, "utf8");

  if (source.includes(replacement)) {
    return;
  }

  if (!source.includes(original)) {
    throw new Error(
      `[xcode27] ${relativePath} no longer matches expo-modules-jsi 56.0.12. ` +
        "Review the upstream package before changing this compatibility patch.",
    );
  }

  fs.writeFileSync(filePath, source.replace(original, replacement));
  console.log(`[xcode27] patched ${relativePath}`);
}

patchFile(
  "Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift",
  `    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)
    let hostObject = expo.HostObject.makeObject(pointee, consume callbacks)

    return JavaScriptObject(self, hostObject)`,
  `    if set == nil {
      let callbacks = expo.HostObjectCallbacks(
        context, getter, nil, propertyNamesGetter, deallocate)
      let hostObject = expo.HostObject.makeObject(pointee, consume callbacks)

      return JavaScriptObject(self, hostObject)
    }
    let callbacks = expo.HostObjectCallbacks(
      context, getter, setter, propertyNamesGetter, deallocate)
    let hostObject = expo.HostObject.makeObject(pointee, consume callbacks)

    return JavaScriptObject(self, hostObject)`,
);

patchFile(
  "scripts/build-xcframework.sh",
  `    BUILD_LIBRARY_FOR_DISTRIBUTION=YES \\
    SKIP_INSTALL=NO \\
    DEBUG_INFORMATION_FORMAT=dwarf-with-dsym \\`,
  `    BUILD_LIBRARY_FOR_DISTRIBUTION=YES \\
    SKIP_INSTALL=NO \\
    CODE_SIGNING_ALLOWED=NO \\
    CODE_SIGNING_REQUIRED=NO \\
    DEBUG_INFORMATION_FORMAT=dwarf-with-dsym \\`,
);
