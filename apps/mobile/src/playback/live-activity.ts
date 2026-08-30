import { Platform } from "react-native";
import type { LiveActivity, LiveActivityDismissalPolicy } from "expo-widgets";
import type { ReadMatePlaybackActivityProps } from "@/widgets/readmate-playback-activity";

let activeActivity: LiveActivity<ReadMatePlaybackActivityProps> | null = null;
let activityModulePromise: Promise<typeof import("@/widgets/readmate-playback-activity")> | null = null;
let lastSignature: string | null = null;
let lastUpdateAt = 0;

const MIN_UPDATE_INTERVAL_MS = 4_000;
const ENABLE_IOS_LIVE_ACTIVITY = false;

export function updatePlaybackLiveActivity(props: ReadMatePlaybackActivityProps, url?: string) {
  if (Platform.OS !== "ios" || !ENABLE_IOS_LIVE_ACTIVITY) return;
  const now = Date.now();
  const signature = signatureForProps(props);
  if (signature === lastSignature && now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
  lastSignature = signature;
  lastUpdateAt = now;

  void updateActivity(props, url);
}

export function endPlaybackLiveActivity(props?: ReadMatePlaybackActivityProps, dismissalPolicy: LiveActivityDismissalPolicy = "immediate") {
  if (Platform.OS !== "ios" || !ENABLE_IOS_LIVE_ACTIVITY) return;
  void endActivity(props, dismissalPolicy);
}

async function updateActivity(props: ReadMatePlaybackActivityProps, url?: string) {
  try {
    const ReadMatePlaybackActivity = await getReadMatePlaybackActivity();
    const activity = activeActivity ?? ReadMatePlaybackActivity.getInstances()[0] ?? ReadMatePlaybackActivity.start(props, url);
    activeActivity = activity;
    await activity.update(props);
  } catch {
    activeActivity = null;
  }
}

async function endActivity(props?: ReadMatePlaybackActivityProps, dismissalPolicy: LiveActivityDismissalPolicy = "immediate") {
  try {
    const ReadMatePlaybackActivity = await getReadMatePlaybackActivity();
    const activity = activeActivity ?? ReadMatePlaybackActivity.getInstances()[0];
    if (activity) await activity.end(dismissalPolicy, props, new Date());
  } catch {
    // Live Activities are best-effort and must never break playback.
  } finally {
    activeActivity = null;
    lastSignature = null;
    lastUpdateAt = 0;
  }
}

async function getReadMatePlaybackActivity() {
  activityModulePromise ??= import("@/widgets/readmate-playback-activity");
  const module = await activityModulePromise;
  return module.default;
}

function signatureForProps(props: ReadMatePlaybackActivityProps) {
  return [
    props.title,
    props.subtitle,
    props.status,
    Math.round(props.percent),
    props.blockLabel,
    props.remainingLabel,
    props.languageLabel,
    props.disclosureLabel
  ].join("|");
}
