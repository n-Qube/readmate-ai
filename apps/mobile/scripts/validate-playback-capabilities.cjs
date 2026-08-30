const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.resolve(__dirname, "..");
const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8"));
const plugins = appJson.expo?.plugins ?? [];
const audioPlugin = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-audio");
const easPlatform = process.env.EAS_BUILD_PLATFORM;

if (!audioPlugin || audioPlugin[1]?.enableBackgroundPlayback !== true) {
  throw new Error("expo-audio must enable background playback for lock-screen controls.");
}

const checks = [
  {
    file: "src/playback/playback-manager.tsx",
    patterns: [
      "setActiveForLockScreen",
      "shouldPlayInBackground: true",
      "showOutputPicker",
      "createSpeechCastUrl",
      "artist: aiAudioMetadataSubtitle",
      "subtitle: aiAudioMetadataSubtitle",
      "disclosureLabel: AI_AUDIO_DISCLOSURE_TITLE"
    ]
  },
  {
    file: "src/widgets/readmate-playback-activity.tsx",
    patterns: ["disclosureLabel: string", "{props.disclosureLabel}"]
  }
];

if (!easPlatform || easPlatform === "ios") {
  checks.push({
    file: "modules/readmate-airplay/ios/ReadMateAirPlayModule.swift",
    patterns: [
      "AVRoutePickerView",
      "prioritizesVideoDevices = false",
      "loadPendingMedia(autoplay: false, force: true)",
      "allowsExternalPlayback = true",
      "AVPlayerItemFailedToPlayToEndTime",
      "MPRemoteCommandCenter.shared()",
      "skipForwardCommand",
      "MPMediaItemPropertyArtist"
    ]
  });
}

if (!easPlatform || easPlatform === "android") {
  checks.push({
    file: "modules/readmate-airplay/android/src/main/java/expo/modules/readmateairplay/ReadMateAirPlayModule.kt",
    patterns: ["MediaRouteButton", "CastContext", "RemoteMediaClient", "ReadMate requires a secure HTTPS audio URL", "MediaMetadata.KEY_ARTIST"]
  });
}

for (const check of checks) {
  const source = fs.readFileSync(path.join(mobileRoot, check.file), "utf8");
  const missing = check.patterns.filter((pattern) => !source.includes(pattern));
  if (missing.length) {
    throw new Error(`${check.file} is missing required playback capability markers: ${missing.join(", ")}`);
  }
}

const moduleConfig = JSON.parse(fs.readFileSync(path.join(mobileRoot, "modules/readmate-airplay/expo-module.config.json"), "utf8"));
if (!moduleConfig.platforms?.includes("apple") || !moduleConfig.platforms?.includes("android")) {
  throw new Error("ReadMateAirPlay must support both Apple AirPlay and Android Chromecast builds.");
}

console.log("Validated background lock-screen controls, native AirPlay, and native Chromecast capability sources.");
