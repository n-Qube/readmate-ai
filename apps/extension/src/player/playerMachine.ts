import type { PlayerState } from "../shared/types";

export type PlayerAction =
  | { type: "LOAD_DOCUMENT"; documentId: string; voice?: string; speed?: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "ENDED" }
  | { type: "ERROR"; error: string }
  | { type: "TIME_UPDATE"; currentTime: number; duration: number }
  | { type: "SEEK_RELATIVE"; seconds: number }
  | { type: "NEXT_CHUNK"; totalChunks: number }
  | { type: "PREVIOUS_CHUNK" }
  | { type: "SET_SPEED"; speed: number }
  | { type: "SET_VOICE"; voice: string };

export function createInitialPlayerState(): PlayerState {
  return {
    status: "idle",
    currentChunkIndex: 0,
    currentTime: 0,
    duration: 0,
    speed: 1,
    voice: "en-US-Neural2-F"
  };
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "LOAD_DOCUMENT":
      return {
        ...state,
        status: "loading",
        currentDocumentId: action.documentId,
        currentChunkIndex: 0,
        currentTime: 0,
        duration: 0,
        voice: action.voice ?? state.voice,
        speed: action.speed ?? state.speed,
        error: undefined
      };
    case "PLAY":
      return { ...state, status: "playing", error: undefined };
    case "PAUSE":
      return { ...state, status: "paused" };
    case "STOP":
      return { ...state, status: "idle", currentTime: 0, duration: 0, error: undefined };
    case "ENDED":
      return { ...state, status: "ended", currentTime: state.duration };
    case "ERROR":
      return { ...state, status: "error", error: action.error };
    case "TIME_UPDATE":
      return {
        ...state,
        currentTime: clamp(action.currentTime, 0, action.duration),
        duration: Math.max(0, action.duration)
      };
    case "SEEK_RELATIVE":
      return {
        ...state,
        currentTime: clamp(state.currentTime + action.seconds, 0, state.duration)
      };
    case "NEXT_CHUNK":
      return {
        ...state,
        currentChunkIndex: Math.min(state.currentChunkIndex + 1, Math.max(action.totalChunks - 1, 0)),
        currentTime: 0,
        duration: 0,
        status: "loading"
      };
    case "PREVIOUS_CHUNK":
      return {
        ...state,
        currentChunkIndex: Math.max(state.currentChunkIndex - 1, 0),
        currentTime: 0,
        duration: 0,
        status: "loading"
      };
    case "SET_SPEED":
      return { ...state, speed: action.speed };
    case "SET_VOICE":
      return { ...state, voice: action.voice };
    default:
      return state;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
