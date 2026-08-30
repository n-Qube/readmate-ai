import { describe, expect, it, vi } from "vitest";
import { GeminiLearningGenerator } from "./gemini";

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
