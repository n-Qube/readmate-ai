export type ChunkDirection = -1 | 1;

export function adjacentChunkIndex(
  currentIndex: number,
  direction: ChunkDirection,
  totalChunks: number
): number | null {
  if (!Number.isFinite(totalChunks) || totalChunks <= 0) return null;

  const lastIndex = Math.max(0, Math.floor(totalChunks) - 1);
  const safeCurrentIndex = Math.min(Math.max(Math.floor(currentIndex), 0), lastIndex);
  const targetIndex = Math.min(Math.max(safeCurrentIndex + direction, 0), lastIndex);

  return targetIndex === safeCurrentIndex ? null : targetIndex;
}
