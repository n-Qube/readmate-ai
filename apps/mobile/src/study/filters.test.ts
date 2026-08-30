import { describe, expect, it } from "vitest";
import { filterStudyItems } from "./filters";
import type { GlobalLearningReview, ReadingDocument } from "@/types";

const baseDocument: ReadingDocument = {
  id: "doc-today",
  userId: "user",
  title: "Today document",
  sourceType: "webpage",
  category: "Technology",
  status: "unread",
  summary: "Summary",
  keyPoints: [],
  flashcards: [{ front: "Front", back: "Back" }],
  quizQuestions: [],
  createdAt: "2026-05-29T08:00:00.000Z",
  updatedAt: "2026-05-29T08:00:00.000Z",
  progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
  provider: "google",
  voice: "en-US-Neural2-F",
  speed: 1,
  blocks: []
};

function documentWith(id: string, updatedAt: string): ReadingDocument {
  return { ...baseDocument, id, title: id, updatedAt };
}

describe("filterStudyItems", () => {
  it("does not fall back to all items for Today while learning review is still loading", () => {
    const documents = [
      documentWith("old", "2026-05-22T08:00:00.000Z"),
      documentWith("today", "2026-05-31T08:00:00.000Z")
    ];

    const filtered = filterStudyItems(documents, undefined, "Today", { now: new Date("2026-05-31T12:00:00.000Z") });

    expect(filtered.map((document) => document.id)).toEqual(["today"]);
  });

  it("uses learning review timestamps before document timestamps for date filters", () => {
    const documents = [
      documentWith("doc-a", "2026-05-31T08:00:00.000Z"),
      documentWith("doc-b", "2026-05-31T08:00:00.000Z")
    ];
    const review: GlobalLearningReview = {
      documents: [
        { documentId: "doc-a", title: "A", sourceType: "webpage", topicTags: [], progressPercent: 0, needsReview: 0, quizAttempts: 0, updatedAt: "2026-05-24T08:00:00.000Z" },
        { documentId: "doc-b", title: "B", sourceType: "webpage", topicTags: [], progressPercent: 0, needsReview: 0, quizAttempts: 0, updatedAt: "2026-05-31T08:00:00.000Z" }
      ],
      totals: { studied: 2, notes: 0, highlights: 0, flashcards: 0, flashcardsReviewed: 0, quizAttempts: 0, averageQuizScore: 0 }
    };

    const filtered = filterStudyItems(documents, review, "Today", { now: new Date("2026-05-31T12:00:00.000Z") });

    expect(filtered.map((document) => document.id)).toEqual(["doc-b"]);
  });
});
