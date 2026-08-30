#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageName = process.env.PLAY_PACKAGE_NAME ?? "ai.readmate.mobile";
const language = process.env.PLAY_LISTING_LANGUAGE ?? "en-US";
const serviceAccountPath = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_PATH;
const assetRoot = path.join(root, "store-assets", "generated-screenshots");

const uploadGroups = [
  {
    imageType: "icon",
    files: [path.join(assetRoot, "google-play-listing", "icon-512x512.png")],
  },
  {
    imageType: "featureGraphic",
    files: [path.join(assetRoot, "google-play-listing", "feature-graphic-1024x500.png")],
  },
  {
    imageType: "phoneScreenshots",
    files: Array.from({ length: 8 }, (_, index) =>
      path.join(
        assetRoot,
        "android",
        "phone-16x9",
        "1080x1920",
        "en-US",
        `${String(index + 1).padStart(2, "0")}-${[
          "save-and-sync",
          "listen-naturally",
          "study-smarter",
          "read-anywhere",
          "catch-key-points",
          "add-any-source",
          "find-it-fast",
          "keep-your-flow",
        ][index]}.png`,
      ),
    ),
  },
];

const base64url = (value) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function assertFilesExist() {
  for (const group of uploadGroups) {
    for (const file of group.files) {
      if (!fs.existsSync(file)) {
        throw new Error(`Missing required asset: ${path.relative(root, file)}`);
      }
    }
  }
}

async function getAccessToken() {
  if (!serviceAccountPath) {
    throw new Error("Set GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_PATH to a service-account file outside this repository.");
  }
  const resolvedServiceAccountPath = path.resolve(serviceAccountPath);
  const repositoryRelative = path.relative(root, resolvedServiceAccountPath);
  if (!repositoryRelative.startsWith("..") && !path.isAbsolute(repositoryRelative)) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_PATH must point outside this repository.");
  }
  const key = JSON.parse(fs.readFileSync(resolvedServiceAccountPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(key.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`OAuth token failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function api(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function uploadImage(accessToken, editId, imageType, file) {
  const url =
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}` +
    `/edits/${editId}/listings/${language}/${imageType}?uploadType=media`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "image/png",
    },
    body: fs.readFileSync(file),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Upload ${path.relative(root, file)} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.image;
}

async function main() {
  assertFilesExist();
  const accessToken = await getAccessToken();
  const edit = await api(
    accessToken,
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`,
    { method: "POST" },
  );

  const result = { packageName, language, editId: edit.id, uploaded: {} };
  try {
    for (const group of uploadGroups) {
      await api(
        accessToken,
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}` +
          `/edits/${edit.id}/listings/${language}/${group.imageType}`,
        { method: "DELETE" },
      ).catch((error) => {
        if (!String(error.message).includes("404")) throw error;
      });

      result.uploaded[group.imageType] = [];
      for (const file of group.files) {
        const image = await uploadImage(accessToken, edit.id, group.imageType, file);
        result.uploaded[group.imageType].push({
          file: path.relative(root, file),
          id: image.id,
          sha256: image.sha256,
        });
      }
    }

    const committed = await api(
      accessToken,
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits/${edit.id}:commit`,
      { method: "POST" },
    );
    result.committedEditId = committed.id;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits/${edit.id}`,
      { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
    ).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
