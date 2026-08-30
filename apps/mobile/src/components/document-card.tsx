import { ContentCard } from "@/components/content-card";
import type { ReadingDocument } from "@/types";

type DocumentCardProps = {
  document: ReadingDocument;
  onPlay?: (document: ReadingDocument) => void;
};

export function DocumentCard({ document, onPlay }: DocumentCardProps) {
  return <ContentCard document={document} onPlay={onPlay} />;
}
