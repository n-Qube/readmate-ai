import { describe, expect, it } from "vitest";
import { evaluateQuizAnswer, evidenceForKeyPoint, flashcardReviewStats, prioritizeFlashcards } from "./session";
import type { LearningFlashcard, LearningQuizQuestion, ReadingBlock } from "@/types";

function card(id: string, reviewStatus: LearningFlashcard["reviewStatus"]): LearningFlashcard {
  return {
    id,
    documentId: "doc",
    question: `Question ${id}`,
    answer: `Answer ${id}`,
    difficulty: "medium",
    reviewStatus,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z"
  };
}

function question(questionType: string, correctAnswer: string): LearningQuizQuestion {
  return {
    id: "question-1",
    documentId: "doc",
    question: "Which city is Ghana's capital?",
    questionType,
    options: ["Accra", "Kumasi"],
    correctAnswer,
    explanation: "Accra is Ghana's capital.",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z"
  };
}

describe("study sessions", () => {
  it("reviews weak cards before new and known cards while preserving order", () => {
    const result = prioritizeFlashcards([
      card("known", "known"),
      card("new-a", "new"),
      card("weak-a", "needs_review"),
      card("weak-b", "needs_review"),
      card("new-b", "new")
    ]);
    expect(result.map((item) => item.id)).toEqual(["weak-a", "weak-b", "new-a", "new-b", "known"]);
    expect(flashcardReviewStats(result)).toEqual({ new: 2, known: 1, needs_review: 2 });
  });

  it("gives immediate feedback for objective questions and guided review for short answers", () => {
    expect(evaluateQuizAnswer(question("multiple_choice", "Accra"), " accra ").status).toBe("correct");
    expect(evaluateQuizAnswer(question("true_false", "True"), "False").status).toBe("incorrect");
    expect(evaluateQuizAnswer(question("short_answer", "Accra"), "The capital is Accra").status).toBe("review");
  });

  it("grounds an AI key point in the closest source section", () => {
    const blocks: ReadingBlock[] = [
      { id: "one", orderIndex: 0, blockType: "paragraph", text: "Unrelated background about the weather." },
      { id: "two", orderIndex: 1, blockType: "page", sourcePageNumber: 4, text: "Ghana's capital Accra is the country's administrative and commercial centre." }
    ];
    expect(evidenceForKeyPoint("Accra is Ghana's administrative capital.", blocks)).toMatchObject({
      blockIndex: 1,
      label: "Page 4"
    });
  });
});
