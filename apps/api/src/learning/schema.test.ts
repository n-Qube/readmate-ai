import { describe, expect, it } from "vitest";
import { askAnswerSchema, learningPayloadSchema } from "./schema.js";
import { quizAttemptSchema } from "../routes/learning.js";

describe("learning schemas", () => {
  it("trims extra Ask AI citations instead of rejecting an otherwise valid answer", () => {
    const parsed = askAnswerSchema.parse({
      answer: "Anthony Gordon scored 18 goals last season.",
      citedSections: Array.from({ length: 8 }, (_value, index) => `Citation ${index + 1}`)
    });

    expect(parsed.citedSections).toHaveLength(6);
    expect(parsed.citedSections.at(-1)).toBe("Citation 6");
  });

  it("keeps generated learning output within backend-supported study depth limits", () => {
    const parsed = learningPayloadSchema.parse({
      summary: {
        short: "Short summary",
        medium: Array.from({ length: 10 }, (_value, index) => `Summary point ${index + 1}`),
        detailed: "Detailed summary"
      },
      keyPoints: Array.from({ length: 15 }, (_value, index) => `Key point ${index + 1}`),
      topicTags: Array.from({ length: 15 }, (_value, index) => `Topic ${index + 1}`),
      flashcards: Array.from({ length: 26 }, (_value, index) => ({
        question: `Flashcard ${index + 1}?`,
        answer: `Answer ${index + 1}`
      })),
      quiz: Array.from({ length: 14 }, (_value, index) => ({
        type: "multiple_choice",
        question: `Quiz ${index + 1}?`,
        options: ["A", "B", "C", "D", "E", "F", "G"],
        correctAnswer: "A",
        explanation: "A is correct."
      }))
    });

    expect(parsed.summary.medium).toHaveLength(8);
    expect(parsed.keyPoints).toHaveLength(12);
    expect(parsed.topicTags).toHaveLength(12);
    expect(parsed.flashcards).toHaveLength(24);
    expect(parsed.quiz).toHaveLength(12);
    expect(parsed.quiz[0]?.options).toHaveLength(6);
  });

  it("rejects quiz attempts with more than 100 answers", () => {
    const answers = Object.fromEntries(Array.from({ length: 101 }, (_value, index) => [`q${index}`, "answer"]));
    expect(() => quizAttemptSchema.parse({ answers })).toThrow("Too many quiz answers");
  });
});
