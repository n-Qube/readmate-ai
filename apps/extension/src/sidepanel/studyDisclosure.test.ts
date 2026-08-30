import { describe, expect, it } from "vitest";
import { STUDY_AI_DISCLOSURE } from "./studyDisclosure";

describe("study AI disclosure", () => {
  it("clearly identifies generated study material without claiming a specific provider or model", () => {
    expect(STUDY_AI_DISCLOSURE).toBe("AI-generated study material · ReadMate");
    expect(STUDY_AI_DISCLOSURE).not.toMatch(/GPT|OpenAI|Gemini/i);
  });
});
