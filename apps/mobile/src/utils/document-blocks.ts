import type { ReadingDocument } from "@/types";

/** Library lists load a summary view without reading blocks; `blockCount` reports how many exist. */
export function documentBlockCount(document: Pick<ReadingDocument, "blocks" | "blockCount"> | null | undefined): number {
  if (!document) return 0;
  return document.blocks.length || document.blockCount || 0;
}

/** True when a list item must be fetched in full before it can be read or played. */
export function needsFullDocument(document: Pick<ReadingDocument, "blocks" | "blockCount">): boolean {
  return document.blocks.length === 0 && (document.blockCount ?? 0) > 0;
}

/**
 * Keep reading text the client already holds when a summary response (list
 * refresh or progress save) arrives for the same document.
 */
export function withKnownBlocks(next: ReadingDocument, known: ReadingDocument | null | undefined): ReadingDocument {
  if (!known || known.id !== next.id || next.blocks.length || !known.blocks.length) return next;
  return { ...next, blocks: known.blocks, blockCount: known.blocks.length };
}
