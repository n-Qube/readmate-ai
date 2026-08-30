import { describe, expect, it } from "vitest";
import { adjacentChunkIndex } from "./playbackNavigation";

describe("adjacentChunkIndex", () => {
  it("moves to the requested neighboring chunk", () => {
    expect(adjacentChunkIndex(2, -1, 5)).toBe(1);
    expect(adjacentChunkIndex(2, 1, 5)).toBe(3);
  });

  it("does not manufacture a move at either boundary", () => {
    expect(adjacentChunkIndex(0, -1, 5)).toBeNull();
    expect(adjacentChunkIndex(4, 1, 5)).toBeNull();
  });

  it("handles empty and out-of-range player state safely", () => {
    expect(adjacentChunkIndex(0, 1, 0)).toBeNull();
    expect(adjacentChunkIndex(99, -1, 3)).toBe(1);
    expect(adjacentChunkIndex(-4, 1, 3)).toBe(1);
  });
});
