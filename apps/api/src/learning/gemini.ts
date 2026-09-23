import { askAnswerSchema, askJsonSchema, learningJsonSchema, learningPayloadSchema, type AskAnswer, type LearningPayload } from "./schema.js";
import { fetchWithTimeout } from "../fetchWithTimeout.js";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

// A full study pack (summary, 12 key points, 24 flashcards, 12 quiz items)
// needs several thousand output tokens. On thinking models, thinking tokens
// share this budget, so a tight cap truncated the JSON and forced fallback.
const LEARNING_MAX_OUTPUT_TOKENS = 16_384;
// Structured generation routinely outlasts the 15 s default for other
// outbound calls; timing out here silently served extractive fallback.
const DEFAULT_LEARNING_TIMEOUT_MS = 45_000;

export type LearningGenerator = {
  generateLearning(input: { title: string; text: string; flashcardCount: number; quizCount: number }): Promise<LearningPayload>;
  answerQuestion(input: { title: string; text: string; question: string }): Promise<AskAnswer>;
};

export class GeminiLearningGenerator implements LearningGenerator {
  constructor(
    private readonly options: {
      apiKey?: string;
      model?: string;
      fetcher?: typeof fetch;
      timeoutMs?: number;
    } = {}
  ) {}

  async generateLearning(input: { title: string; text: string; flashcardCount: number; quizCount: number }): Promise<LearningPayload> {
    const prompt =
      [
        "Create study material for this ReadMate document.",
        "Return concise, accurate study output based only on the provided text. Never add facts that are not supported by it.",
        `Create exactly ${input.flashcardCount} flashcards and exactly ${input.quizCount} quiz questions.`,
        "Key points must be distinct, specific, and useful for recall. Each key point should state one idea and why it matters in no more than two sentences.",
        "Do not repeat the headline, title, navigation text, publication boilerplate, or the same fact in different wording.",
        "Preserve important names, numbers, dates, claims, causes, risks, and conclusions exactly as the document presents them.",
        "Flashcards must teach. Do not use the document title, headline, or a copied sentence as the question.",
        "Each flashcard question should test one specific concept, cause, figure, person, risk, claim, or implication from the document.",
        "Each flashcard answer should be self-contained and one or two clear explanatory sentences, not a long pasted paragraph.",
        "Avoid duplicate flashcards. Vary recall between facts, relationships, causes, consequences, comparisons, and implications.",
        "Quiz questions must be answerable from the document. Multiple-choice questions need one unambiguously correct answer and plausible distractors that the document does not support.",
        "Every quiz explanation must say why the correct answer follows from the document, not merely repeat the answer.",
        "For longer academic or research documents, spread material across the whole document and vary difficulty and quiz question types.",
        `Title: ${input.title}`,
        `Document:\n${clipDocumentText(input.text)}`
      ].join("\n\n");
    return this.generateValidatedJson(prompt, learningJsonSchema, (text) => learningPayloadSchema.parse(JSON.parse(text)));
  }

  async answerQuestion(input: { title: string; text: string; question: string }): Promise<AskAnswer> {
    const prompt =
      [
        "Answer the user's question using only this ReadMate document.",
        "If the answer is not present, say that the document does not provide enough information.",
        "Give the direct answer first, then a short explanation.",
        "Cited sections must be short, exact supporting excerpts or section titles from the supplied document.",
        `Title: ${input.title}`,
        `Question: ${input.question}`,
        `Document:\n${clipDocumentText(input.text)}`
      ].join("\n\n");
    return this.generateValidatedJson(prompt, askJsonSchema, (text) => askAnswerSchema.parse(JSON.parse(text)));
  }

  private async generateValidatedJson<T>(prompt: string, responseJsonSchema: unknown, parse: (text: string) => T): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return parse(await this.generateJson(prompt, responseJsonSchema));
      } catch (error) {
        lastError = error;
        // A request that consumed the complete outbound deadline should fall
        // back immediately. Retrying it only doubles the wait before users see
        // usable extractive Study material.
        if (isTimeoutError(error) || (error instanceof Error && error.message.includes("not configured"))) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Gemini did not return valid structured study material.");
  }

  private async generateJson(prompt: string, responseJsonSchema: unknown): Promise<string> {
    const apiKey = this.options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini is not configured. Set GEMINI_API_KEY on the backend.");
    const model = this.options.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema,
          temperature: 0.2,
          maxOutputTokens: LEARNING_MAX_OUTPUT_TOKENS,
          ...thinkingConfigForModel(model)
        }
      })
    }, { fetcher: this.options.fetcher, timeoutMs: this.options.timeoutMs ?? learningTimeoutFromEnv() });
    const body = (await response.json()) as GeminiResponse;
    if (!response.ok) throw new Error(body.error?.message ?? "Gemini request failed.");
    if (body.promptFeedback?.blockReason) throw new Error(`Gemini blocked the study request (${body.promptFeedback.blockReason}).`);
    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
    if (candidate?.finishReason === "MAX_TOKENS") throw new Error("Gemini study output was truncated at the token limit.");
    if (!text) throw new Error(`Gemini did not return structured JSON${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}.`);
    return text;
  }
}

/**
 * Gemini 2.5 Flash thinks by default, which slows structured extraction and
 * spends the output budget. Grounded study extraction does not need it.
 */
export function thinkingConfigForModel(model: string): { thinkingConfig?: { thinkingBudget: number } } {
  return /^gemini-2\.5-flash(?!-lite)/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
}

function learningTimeoutFromEnv(): number {
  const configured = Number(process.env.GEMINI_LEARNING_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LEARNING_TIMEOUT_MS;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const timeoutLike = error as { name?: unknown; code?: unknown; cause?: unknown };
  if (timeoutLike.name === "TimeoutError") return true;
  if (typeof timeoutLike.code === "string" && /TIMEOUT|TIMEDOUT/i.test(timeoutLike.code)) return true;
  return timeoutLike.cause !== error && isTimeoutError(timeoutLike.cause);
}

function clipDocumentText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 24_000);
}
