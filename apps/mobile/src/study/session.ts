import type { LearningFlashcard, LearningQuizQuestion, ReadingBlock } from "@/types";

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between", "could", "from", "have", "into", "more", "most", "other", "should", "their", "there", "these", "they", "this", "those", "through", "under", "very", "what", "when", "where", "which", "while", "with", "would", "your"
]);

export type QuizAnswerFeedback = {
  status: "correct" | "incorrect" | "review";
  correctAnswer: string;
  explanation: string;
};

export type HighlightEvidence = {
  blockIndex: number;
  excerpt: string;
  label: string;
};

export function prioritizeFlashcards(cards: LearningFlashcard[]): LearningFlashcard[] {
  const priority: Record<LearningFlashcard["reviewStatus"], number> = {
    needs_review: 0,
    new: 1,
    known: 2
  };
  return cards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => priority[left.card.reviewStatus] - priority[right.card.reviewStatus] || left.index - right.index)
    .map(({ card }) => card);
}

export function flashcardReviewStats(cards: LearningFlashcard[]) {
  return cards.reduce(
    (stats, card) => {
      stats[card.reviewStatus] += 1;
      return stats;
    },
    { new: 0, known: 0, needs_review: 0 }
  );
}

export function evaluateQuizAnswer(question: LearningQuizQuestion, answer: string): QuizAnswerFeedback {
  const normalizedAnswer = normalizeAnswer(answer);
  const normalizedCorrectAnswer = normalizeAnswer(question.correctAnswer);
  const canScoreImmediately = question.questionType !== "short_answer";
  return {
    status: canScoreImmediately
      ? normalizedAnswer === normalizedCorrectAnswer
        ? "correct"
        : "incorrect"
      : "review",
    correctAnswer: question.correctAnswer,
    explanation: question.explanation
  };
}

export function evidenceForKeyPoint(point: string, blocks: ReadingBlock[]): HighlightEvidence | null {
  const pointTokens = contentTokens(point);
  if (!pointTokens.size) return null;
  const ranked = blocks
    .filter((block) => block.text.trim())
    .map((block) => {
      const blockTokens = contentTokens(block.text);
      let overlap = 0;
      for (const token of pointTokens) {
        if (blockTokens.has(token)) overlap += token.length >= 8 ? 2 : 1;
      }
      return { block, overlap };
    })
    .filter(({ overlap }) => overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || left.block.orderIndex - right.block.orderIndex);
  const best = ranked[0]?.block;
  if (!best) return null;
  return {
    blockIndex: best.orderIndex,
    excerpt: excerptForDisplay(best.text),
    label: best.sourcePageNumber ? `Page ${best.sourcePageNumber}` : `Section ${best.orderIndex + 1}`
  };
}

function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contentTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
  );
}

function excerptForDisplay(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217).trimEnd()}…`;
}
