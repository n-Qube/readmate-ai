import { describe, expect, it } from "vitest";
import {
  AI_AUDIO_DISCLOSURE_ACCESSIBILITY_LABEL,
  AI_AUDIO_DISCLOSURE_DETAIL,
  AI_AUDIO_DISCLOSURE_TITLE,
  aiAudioMetadataSubtitle,
  compactAiAudioDisclosure,
  shouldShowAiAudioDisclosure
} from "./ai-audio-disclosure";

describe("AI audio disclosure", () => {
  it("clearly identifies generated speech and distinguishes it from original narration", () => {
    expect(AI_AUDIO_DISCLOSURE_TITLE).toMatch(/AI-generated speech/i);
    expect(AI_AUDIO_DISCLOSURE_DETAIL).toMatch(/not the original human narration/i);
    expect(AI_AUDIO_DISCLOSURE_ACCESSIBILITY_LABEL).toBe(
      "AI-generated speech. Synthetic voice—not the original human narration."
    );
  });

  it("keeps the compact player's playback state visible beside the disclosure", () => {
    expect(compactAiAudioDisclosure("Paused")).toBe("AI-generated speech · Paused");
    expect(compactAiAudioDisclosure("  ")).toBe("AI-generated speech");
  });

  it("places the disclosure first in lock-screen and casting metadata", () => {
    expect(aiAudioMetadataSubtitle("BBC News")).toBe("AI-generated speech · BBC News");
    expect(aiAudioMetadataSubtitle("  RSS  ")).toBe("AI-generated speech · RSS");
    expect(aiAudioMetadataSubtitle()).toBe("AI-generated speech");
  });

  it.each(["featured", "compact", "expanded"] as const)(
    "shows disclosure on the %s player only when a document is active",
    (variant) => {
      expect(shouldShowAiAudioDisclosure(variant, true)).toBe(true);
      expect(shouldShowAiAudioDisclosure(variant, false)).toBe(false);
    }
  );
});
