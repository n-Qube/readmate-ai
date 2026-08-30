export { addOutputStateListener, loadOutputMedia, sendOutputCommand, type OutputMedia, type OutputState } from "../../modules/readmate-airplay/src/ReadMateAirPlayModule";
import { showOutputPicker as showNativeOutputPicker, type OutputMedia } from "../../modules/readmate-airplay/src/ReadMateAirPlayModule";

export function showOutputPicker(media?: OutputMedia): void {
  showNativeOutputPicker(media);
}
