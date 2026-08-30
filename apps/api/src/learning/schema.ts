import { z } from "zod";

function cappedStringArray(maxItems: number, maxLength: number, minimumItems = 0) {
  return z.preprocess(
    (value) => (Array.isArray(value) ? value.slice(0, maxItems) : value),
    z.array(z.string().trim().min(1).max(maxLength)).min(minimumItems).max(maxItems)
  );
}

function cappedObjectArray<T extends z.ZodTypeAny>(schema: T, maxItems: number, minimumItems = 0) {
  return z.preprocess((value) => (Array.isArray(value) ? value.slice(0, maxItems) : value), z.array(schema).min(minimumItems).max(maxItems));
}

export const summarySchema = z.object({
  short: z.string().trim().min(1).max(1000),
  medium: cappedStringArray(8, 500, 1),
  detailed: z.string().trim().min(1).max(4000)
});

export const flashcardSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(1000)
});

export const quizQuestionSchema = z.object({
  type: z.enum(["multiple_choice", "true_false", "short_answer", "fill_blank"]),
  question: z.string().trim().min(1).max(500),
  options: cappedStringArray(6, 200, 2).optional(),
  correctAnswer: z.string().trim().min(1).max(1000),
  explanation: z.string().trim().min(1).max(1000)
});

export const learningPayloadSchema = z.object({
  summary: summarySchema,
  keyPoints: cappedStringArray(12, 500, 1),
  topicTags: cappedStringArray(12, 80, 1),
  flashcards: cappedObjectArray(flashcardSchema, 24, 1),
  quiz: cappedObjectArray(quizQuestionSchema, 12, 1)
});

export const askAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  citedSections: cappedStringArray(6, 300).default([])
});

export type LearningPayload = z.infer<typeof learningPayloadSchema>;
export type AskAnswer = z.infer<typeof askAnswerSchema>;

export const studyComponentTypes = [
  "SummaryCard",
  "KeyPointsList",
  "QuizQuestionCard",
  "FlashcardDeck",
  "StudyPlanCard",
  "ReviewProgressCard",
  "HighlightCard",
  "NoteInput",
  "ActionButton"
] as const;

export const studyUiComponentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.enum(studyComponentTypes),
  props: z.record(z.unknown())
});

export const studyUiSchema = z.object({
  documentId: z.string().trim().min(1),
  components: z.array(studyUiComponentSchema).max(30)
});

export type StudyUiComponent = z.infer<typeof studyUiComponentSchema>;
export type StudyUi = z.infer<typeof studyUiSchema>;

export const learningJsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        short: { type: "string", description: "Short one paragraph summary." },
        medium: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, description: "Three to six study-friendly summary bullets." },
        detailed: { type: "string", description: "Detailed explanation of the document." }
      },
      required: ["short", "medium", "detailed"]
    },
    keyPoints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12, description: "Important points to remember." },
    topicTags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12, description: "Short topic tags." },
    flashcards: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"]
      }
    },
    quiz: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["multiple_choice", "true_false", "short_answer", "fill_blank"] },
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
          correctAnswer: { type: "string" },
          explanation: { type: "string" }
        },
        required: ["type", "question", "correctAnswer", "explanation"]
      }
    }
  },
  required: ["summary", "keyPoints", "topicTags", "flashcards", "quiz"]
} as const;

export const askJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Answer based only on the supplied document text." },
    citedSections: { type: "array", items: { type: "string" }, maxItems: 6, description: "Up to six short supporting snippets or section titles." }
  },
  required: ["answer", "citedSections"]
} as const;
