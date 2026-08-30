import { describe, expect, it } from "vitest";
import { createInitialPlayerState, playerReducer } from "./playerMachine";

describe("playerReducer", () => {
  it("loads a document and keeps the selected speed and voice", () => {
    const state = playerReducer(createInitialPlayerState(), {
      type: "LOAD_DOCUMENT",
      documentId: "doc_123",
      voice: "cedar",
      speed: 1.25
    });

    expect(state).toMatchObject({
      status: "loading",
      currentDocumentId: "doc_123",
      currentChunkIndex: 0,
      currentTime: 0,
      duration: 0,
      voice: "cedar",
      speed: 1.25
    });
  });

  it("moves to the next and previous chunks without going below zero", () => {
    const loaded = playerReducer(createInitialPlayerState(), {
      type: "LOAD_DOCUMENT",
      documentId: "doc_123"
    });

    const next = playerReducer(loaded, { type: "NEXT_CHUNK", totalChunks: 3 });
    const previous = playerReducer(next, { type: "PREVIOUS_CHUNK" });
    const previousAgain = playerReducer(previous, { type: "PREVIOUS_CHUNK" });

    expect(next.currentChunkIndex).toBe(1);
    expect(previous.currentChunkIndex).toBe(0);
    expect(previousAgain.currentChunkIndex).toBe(0);
  });

  it("seeks by seconds within duration bounds", () => {
    const playing = playerReducer(createInitialPlayerState(), {
      type: "TIME_UPDATE",
      currentTime: 30,
      duration: 100
    });

    expect(playerReducer(playing, { type: "SEEK_RELATIVE", seconds: -45 }).currentTime).toBe(0);
    expect(playerReducer(playing, { type: "SEEK_RELATIVE", seconds: 80 }).currentTime).toBe(100);
  });
});
