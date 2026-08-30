import type { GlobalLearningReview, ReadingDocument } from "@/types";

export type ReviewFilter = "Today" | "This week" | "Needs review" | "Completed" | "Low quiz score" | "By topic" | "By source" | "By content type";

type FilterOptions = {
  now?: Date;
};

export function filterStudyItems(
  documents: ReadingDocument[],
  review: GlobalLearningReview | undefined,
  filter: ReviewFilter,
  options: FilterOptions = {}
): ReadingDocument[] {
  const reviewByDocument = new Map(review?.documents.map((item) => [item.documentId, item]) ?? []);

  if (filter === "Needs review") {
    return review ? documents.filter((document) => (reviewByDocument.get(document.id)?.needsReview ?? 0) > 0) : [];
  }
  if (filter === "Completed") return documents.filter((document) => document.progress.percent >= 100);
  if (filter === "Low quiz score") {
    return review ? documents.filter((document) => (reviewByDocument.get(document.id)?.bestQuizScore ?? 100) < 70) : [];
  }
  if (filter === "Today") {
    const start = startOfToday(options.now ?? new Date());
    return documents.filter((document) => reviewTimestamp(document, reviewByDocument) >= start.getTime());
  }
  if (filter === "This week") {
    const start = (options.now ?? new Date()).getTime() - 7 * 24 * 60 * 60 * 1000;
    return documents.filter((document) => reviewTimestamp(document, reviewByDocument) >= start);
  }
  if (filter === "By topic") return [...documents].sort((a, b) => a.category.localeCompare(b.category));
  if (filter === "By source") return [...documents].sort((a, b) => (a.sourceLabel ?? "").localeCompare(b.sourceLabel ?? ""));
  if (filter === "By content type") return [...documents].sort((a, b) => a.sourceType.localeCompare(b.sourceType));
  return documents;
}

function reviewTimestamp(
  document: ReadingDocument,
  reviewByDocument: Map<string, GlobalLearningReview["documents"][number]>
): number {
  const reviewUpdatedAt = reviewByDocument.get(document.id)?.updatedAt;
  const timestamp = Date.parse(reviewUpdatedAt ?? document.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function startOfToday(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}
