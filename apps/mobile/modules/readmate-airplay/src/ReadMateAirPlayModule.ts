import { NativeModule, requireOptionalNativeModule } from 'expo';

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

type ReadMateAirPlayEvents = {
  onOutputStateChanged: (event: OutputState) => void;
};

declare class ReadMateAirPlayModule extends NativeModule<ReadMateAirPlayEvents> {}

const module = requireOptionalNativeModule<ReadMateAirPlayModule>('ReadMateAirPlay') as (ReadMateAirPlayModule & {
  showPicker?: (uri: string, title: string, subtitle: string, artworkUrl: string, currentTime: number, duration: number) => void;
  loadMedia?: (uri: string, title: string, subtitle: string, artworkUrl: string, currentTime: number, duration: number) => void;
  sendCommand?: (command: "play" | "pause" | "stop" | "seekBy", value: number) => void;
}) | null;

export function showOutputPicker(media?: OutputMedia): void {
  const values = mediaValues(media);
  module?.showPicker?.(...values);
}

export function loadOutputMedia(media: OutputMedia): void {
  module?.loadMedia?.(...mediaValues(media));
}

export function sendOutputCommand(command: "play" | "pause" | "stop" | "seekBy", value = 0): void {
  module?.sendCommand?.(command, value);
}

export function addOutputStateListener(listener: (state: OutputState) => void) {
  return module?.addListener("onOutputStateChanged", listener) ?? { remove() {} };
}

export const showAirPlayPicker = showOutputPicker;

export default module;

function mediaValues(media?: OutputMedia): [string, string, string, string, number, number] {
  return [
    media?.uri ?? "",
    media?.title ?? "ReadMate",
    media?.subtitle ?? "",
    media?.artworkUrl ?? "",
    media?.currentTime ?? 0,
    media?.duration ?? 0
  ];
}
