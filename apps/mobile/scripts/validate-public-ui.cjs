const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { PUBLIC_CLIENT_VARIABLE_SET } = require("./public-env-contract.cjs");

const mobileRoot = path.resolve(__dirname, "..");
const sourceRoots = [path.join(mobileRoot, "app"), path.join(mobileRoot, "src")];
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const displayedAttributes = new Set([
  "accessibilityHint",
  "accessibilityLabel",
  "children",
  "description",
  "href",
  "label",
  "subtitle",
  "title",
  "to"
]);
const forbiddenPatterns = [
  {
    pattern: /\bsync endpoint\b/i,
    reason: "customer-facing mobile code must not render infrastructure diagnostics"
  },
  {
    pattern: /\buses this API endpoint\b/i,
    reason: "customer-facing mobile code must not explain or expose its backend endpoint"
  },
  {
    pattern: /https:\/\/[a-z0-9-]+(?:-[a-z0-9]+)?\.a\.run\.app\b/i,
    reason: "Cloud Run hostnames must come from release configuration, never public UI source"
  }
];
const forbiddenDisplayedPatterns = [
  ...forbiddenPatterns,
  {
    pattern: /https:\/\/api(?:[-.][a-z0-9]+)*\.[a-z0-9.-]+\b/i,
    reason: "customer-facing UI must not link to a raw API hostname"
  }
];
const apiExpressionPattern = /\b(?:apiBaseUrl|EXPO_PUBLIC_READMATE_API_URL|READMATE_API_URL)\b/;
const backendEnvironmentNamePattern = /(?:SECRET|PRIVATE_KEY|DIGEST_KEY|SERVICE_ROLE|DATABASE_URL|CRON_SECRET|CARTESIA_API_KEY|KHAYA_API_KEY|GEMINI_API_KEY|GOOGLE_SERVICE_ACCOUNT)/;

const failures = [];

for (const sourceRoot of sourceRoots) {
  walk(sourceRoot);
}

if (failures.length) {
  console.error("Public UI validation failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.reason}`);
  }
  process.exit(1);
}

console.log("Public UI validation passed: no API endpoint diagnostics, backend secrets, or unreviewed public variables are exposed by mobile UI source.");

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath);
      continue;
    }
    if (!sourceExtensions.has(path.extname(entry.name))) continue;

    const source = fs.readFileSync(entryPath, "utf8");
    const relativeFile = path.relative(mobileRoot, entryPath);
    for (const rule of forbiddenPatterns) {
      if (!rule.pattern.test(source)) continue;
      failures.push({
        file: relativeFile,
        reason: rule.reason
      });
    }

    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const name = match[1];
      if (name.startsWith("EXPO_PUBLIC_") && !PUBLIC_CLIENT_VARIABLE_SET.has(name)) {
        failures.push({
          file: relativeFile,
          reason: `${name} is not in the reviewed Expo public-variable allowlist`
        });
      } else if (!name.startsWith("EXPO_PUBLIC_") && backendEnvironmentNamePattern.test(name)) {
        failures.push({
          file: relativeFile,
          reason: `${name} is backend-only and cannot be referenced by client source`
        });
      }
    }

    if (/\.[jt]sx$/.test(entry.name)) inspectRenderedUi(relativeFile, source);
  }
}

function inspectRenderedUi(relativeFile, source) {
  const sourceFile = ts.createSourceFile(relativeFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  visit(sourceFile);

  function visit(node) {
    if (ts.isJsxText(node)) inspectDisplayedText(node.getText(sourceFile));

    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      inspectDisplayedExpression(node.expression?.getText(sourceFile) ?? "");
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (displayedAttributes.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) inspectDisplayedText(node.initializer.text);
        else if (ts.isJsxExpression(node.initializer)) {
          inspectDisplayedExpression(node.initializer.expression?.getText(sourceFile) ?? "");
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const target = node.expression.getText(sourceFile);
      if (/^(?:Linking\.openURL|window\.open)$/.test(target)) {
        inspectDisplayedExpression(node.arguments[0]?.getText(sourceFile) ?? "");
      }
    }

    ts.forEachChild(node, visit);
  }

  function inspectDisplayedText(text) {
    for (const rule of forbiddenDisplayedPatterns) {
      if (!rule.pattern.test(text)) continue;
      failures.push({ file: relativeFile, reason: rule.reason });
    }
  }

  function inspectDisplayedExpression(expression) {
    if (apiExpressionPattern.test(expression)) {
      failures.push({
        file: relativeFile,
        reason: "customer-facing text or links must not render the configured API origin"
      });
    }
    inspectDisplayedText(expression);
  }
}
