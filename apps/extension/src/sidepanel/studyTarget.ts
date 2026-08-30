import type { ReadingDocument } from "../shared/types";

export function resolveLearningTarget(
  history: ReadingDocument[],
  playerDocumentId?: string,
  panelDocumentId?: string
): ReadingDocument | undefined {
  const panelDocument = panelDocumentId
    ? history.find((item) => item.id === panelDocumentId)
    : undefined;
  const playerDocument = playerDocumentId
    ? history.find((item) => item.id === playerDocumentId)
    : undefined;
  return panelDocument ?? playerDocument ?? history[0];
}
