import { ApiError } from "../api/client";

export function playbackErrorMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : "";
  if (caught instanceof ApiError && caught.status === 429) {
    // The API's free-plan quota is per UTC day, which is Ghana's local day.
    return /daily usage limit/i.test(message)
      ? "You've used today's free listening allowance. It resets at midnight GMT."
      : "Too many audio requests at once. Wait a moment, then tap play.";
  }
  if (caught instanceof ApiError && [502, 503, 504].includes(caught.status)) {
    return "ReadMate audio is temporarily busy. Tap play to retry in a moment.";
  }
  if (/sentences? that are too long|content is too long|input.*too long|maximum.*(bytes|characters)|SSML sentence/i.test(message)) {
    return "This section was too long to prepare. Tap play to retry it in smaller parts.";
  }
  if (/credentials are not configured|GOOGLE_TTS_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_SERVICE_ACCOUNT_JSON|quota|billing/i.test(message)) {
    return "Google voice is temporarily unavailable. Try again in a moment.";
  }
  if (/401|403|unauthorized|forbidden|session|token/i.test(message)) {
    return "Your reading session needs to be refreshed. Open Settings, sign in again, then try playback.";
  }
  return message || "Could not start playback.";
}
