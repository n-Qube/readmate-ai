import { describe, expect, it } from "vitest";
import { syntheticSpeechDisclosure } from "./speechDisclosure";

describe("synthetic speech disclosure", () => {
  it("names cloud narration as AI-generated", () => {
    expect(syntheticSpeechDisclosure("cloud", "Google TTS")).toBe(
      "AI-generated voice. ReadMate creates this narration with Google TTS; it is not a human recording."
    );
  });

  it("clearly identifies browser fallback speech", () => {
    expect(syntheticSpeechDisclosure("browser", "Google TTS")).toContain("Synthetic browser voice");
  });
});
