export type OutputMedia = {
  uri: string;
  title: string;
  subtitle: string;
  artworkUrl?: string;
  currentTime?: number;
  duration?: number;
};

export type OutputState = {
  connected: boolean;
  platform: "airplay" | "chromecast" | "local";
  deviceName?: string;
  isScreen?: boolean;
  playbackState?: "idle" | "loading" | "playing" | "paused" | "completed" | "error";
  currentTime?: number;
  duration?: number;
  error?: string;
};

export function showOutputPicker(_media?: OutputMedia): void {
  // Output routing is only available in the native iOS and Android builds.
}

export function loadOutputMedia(_media: OutputMedia): void {}

export function sendOutputCommand(_command: "play" | "pause" | "stop" | "seekBy", _value = 0): void {}

export function addOutputStateListener(_listener: (state: OutputState) => void) {
  return { remove() {} };
}
