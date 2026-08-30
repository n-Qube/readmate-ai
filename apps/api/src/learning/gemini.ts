import { askAnswerSchema, askJsonSchema, learningJsonSchema, learningPayloadSchema, type AskAnswer, type LearningPayload } from "./schema.js";
import { fetchWithTimeout } from "../fetchWithTimeout.js";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

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
          maxOutputTokens: 8192
        }
      })
    }, { fetcher: this.options.fetcher });
    const body = (await response.json()) as GeminiResponse;
    if (!response.ok) throw new Error(body.error?.message ?? "Gemini request failed.");
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini did not return structured JSON.");
    return text;
  }
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
