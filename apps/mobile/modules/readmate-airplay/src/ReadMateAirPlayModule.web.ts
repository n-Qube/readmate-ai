import { registerWebModule, NativeModule } from 'expo';
import type { OutputMedia, OutputState } from "./ReadMateAirPlayModule";

class ReadMateAirPlayModule extends NativeModule<{}> {}

const module = registerWebModule(ReadMateAirPlayModule, 'ReadMateAirPlayModule');

export function showOutputPicker(_media?: OutputMedia): void {
  // Output routing is provided by the native iOS/Android modules.
}

export function loadOutputMedia(_media: OutputMedia): void {}

export function sendOutputCommand(_command: "play" | "pause" | "stop" | "seekBy", _value = 0): void {}

export function addOutputStateListener(_listener: (state: OutputState) => void) {
  return { remove() {} };
}

export const showAirPlayPicker = showOutputPicker;

export default module;
