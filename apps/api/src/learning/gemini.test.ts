import { describe, expect, it, vi } from "vitest";
import { GeminiLearningGenerator, thinkingConfigForModel } from "./gemini";

const validLearning = {
  summary: {
    short: "Accra is Ghana's capital.",
    medium: ["Accra is the administrative capital."],
    detailed: "The document explains that Accra is Ghana's administrative capital."
  },
  keyPoints: ["Accra is Ghana's administrative capital and a major commercial centre."],
  topicTags: ["Ghana"],
  flashcards: [{ question: "What role does Accra have in Ghana?", answer: "It is Ghana's administrative capital." }],
  quiz: [{ type: "multiple_choice", question: "Which city is Ghana's capital?", options: ["Accra", "Kumasi"], correctAnswer: "Accra", explanation: "The document identifies Accra as Ghana's capital." }]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("GeminiLearningGenerator", () => {
  it("retries once when Gemini returns malformed structured output", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(validLearning) }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    const result = await generator.generateLearning({ title: "Ghana", text: "Accra is Ghana's capital.", flashcardCount: 1, quizCount: 1 });

    expect(result.flashcards).toHaveLength(1);
    expect(result.quiz).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a request that exhausted the outbound timeout", async () => {
    const timeout = new DOMException("The operation was aborted.", "TimeoutError");
    const fetcher = vi.fn().mockRejectedValue(timeout);
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    await expect(generator.generateLearning({
      title: "Ghana",
      text: "Accra is Ghana's capital.",
      flashcardCount: 1,
      quizCount: 1
    })).rejects.toMatchObject({ name: "TimeoutError" });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not confuse malformed JSON containing the word timeout with a network timeout", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ candidates: [{ content: { parts: [{ text: "timeout" }] } }] }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(validLearning) }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    const result = await generator.generateLearning({
      title: "Ghana",
      text: "Accra is Ghana's capital.",
      flashcardCount: 1,
      quizCount: 1
    });

    expect(result.summary.short).toContain("Accra");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry an Undici timeout wrapped as a fetch failure", async () => {
    const timeout = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" }
    });
    const fetcher = vi.fn().mockRejectedValue(timeout);
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    await expect(generator.generateLearning({
      title: "Ghana",
      text: "Accra is Ghana's capital.",
      flashcardCount: 1,
      quizCount: 1
    })).rejects.toBe(timeout);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requests low-variance grounded output with explanations", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(validLearning) }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    await generator.generateLearning({ title: "Ghana", text: "Accra is Ghana's capital.", flashcardCount: 1, quizCount: 1 });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    const prompt = body.contents[0].parts[0].text as string;
    expect(body.generationConfig.temperature).toBe(0.2);
    expect(prompt).toContain("Never add facts that are not supported");
    expect(prompt).toContain("why the correct answer follows from the document");
  });
});

describe("Gemini study request configuration", () => {
  it("disables thinking on 2.5 Flash and leaves other models on their defaults", () => {
    expect(thinkingConfigForModel("gemini-2.5-flash")).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingConfigForModel("gemini-2.5-flash-lite")).toEqual({});
    expect(thinkingConfigForModel("gemini-3.8-flash")).toEqual({});
  });

  it("requests a study-sized output budget with thinking disabled", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(validLearning) }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", model: "gemini-2.5-flash", fetcher: fetcher as typeof fetch });

    await generator.generateLearning({ title: "Ghana", text: "Accra is Ghana's capital.", flashcardCount: 24, quizCount: 12 });

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 16_384, thinkingConfig: { thinkingBudget: 0 } });
  });

  it("reports truncated output instead of trying to parse partial JSON", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{\"summary\":" }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    await expect(generator.generateLearning({ title: "Ghana", text: "Accra.", flashcardCount: 1, quizCount: 1 }))
      .rejects.toThrow(/truncated at the token limit/);
  });

  it("ignores thought parts when reading the structured answer", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ candidates: [{ content: { parts: [{ thought: true, text: "thinking..." }, { text: JSON.stringify(validLearning) }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    await expect(generator.generateLearning({ title: "Ghana", text: "Accra.", flashcardCount: 1, quizCount: 1 })).resolves.toMatchObject({ topicTags: ["Ghana"] });
  });
});

describe("focused study generation", () => {
  it("requests only flashcards with a flashcard-only schema", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ flashcards: validLearning.flashcards }) }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    await expect(generator.generateFlashcards({ title: "Ghana", text: "Accra.", count: 5 })).resolves.toEqual(validLearning.flashcards);

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(Object.keys(body.generationConfig.responseJsonSchema.properties)).toEqual(["flashcards"]);
    expect(body.contents[0].parts[0].text).toContain("Create exactly 5 flashcards.");
    expect(body.contents[0].parts[0].text).not.toContain("quiz questions");
  });

  it("requests only quiz questions with a quiz-only schema", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ quiz: validLearning.quiz }) }] } }] }));
    const generator = new GeminiLearningGenerator({ apiKey: "test-key", fetcher: fetcher as typeof fetch });

    await expect(generator.generateQuiz({ title: "Ghana", text: "Accra.", count: 3 })).resolves.toMatchObject([{ correctAnswer: "Accra" }]);
    expect(Object.keys(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).generationConfig.responseJsonSchema.properties)).toEqual(["quiz"]);
  });
});
