import { describe, expect, it } from "vitest";
import { documentBlockCount, needsFullDocument, withKnownBlocks } from "./document-blocks";

const block = { id: "b1", orderIndex: 0, blockType: "paragraph" as const, text: "Hello." };

describe("document block helpers", () => {
  it("counts loaded blocks, falling back to the summary blockCount", () => {
    expect(documentBlockCount({ blocks: [block], blockCount: 9 })).toBe(1);
    expect(documentBlockCount({ blocks: [], blockCount: 9 })).toBe(9);
    expect(documentBlockCount({ blocks: [] })).toBe(0);
    expect(documentBlockCount(undefined)).toBe(0);
  });

  it("needs a full fetch only for summary items that have blocks on the server", () => {
    expect(needsFullDocument({ blocks: [], blockCount: 3 })).toBe(true);
    expect(needsFullDocument({ blocks: [block], blockCount: 1 })).toBe(false);
    expect(needsFullDocument({ blocks: [], blockCount: 0 })).toBe(false);
    expect(needsFullDocument({ blocks: [] })).toBe(false);
  });
});

describe("withKnownBlocks", () => {
  const full = { id: "d1", blocks: [block], progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 } } as unknown as import("@/types").ReadingDocument;
  const summary = { ...full, blocks: [], blockCount: 1, progress: { ...full.progress, percent: 40 } };

  it("keeps loaded text while taking the newer metadata", () => {
    const merged = withKnownBlocks(summary, full);
    expect(merged.blocks).toEqual([block]);
    expect(merged.progress.percent).toBe(40);
  });

  it("never mixes text across documents or overrides a full response", () => {
    expect(withKnownBlocks(summary, { ...full, id: "other" })).toBe(summary);
    expect(withKnownBlocks(full, summary)).toBe(full);
    expect(withKnownBlocks(summary, undefined)).toBe(summary);
  });
});
