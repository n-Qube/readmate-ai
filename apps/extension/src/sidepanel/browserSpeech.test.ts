import { describe, expect, it } from "vitest";
import { splitBrowserSpeechSegments } from "./browserSpeech";

describe("splitBrowserSpeechSegments", () => {
  it("returns no segments for empty text", () => {
    expect(splitBrowserSpeechSegments(" \n\t ")).toEqual([]);
  });

  it("keeps short text as one trimmed segment", () => {
    expect(splitBrowserSpeechSegments("  Read this sentence.  ")).toEqual([
      { text: "Read this sentence.", startOffset: 2, endOffset: 21 }
    ]);
  });

  it("splits long browser speech text at sentence boundaries", () => {
    const text = [
      "First sentence is safe and short enough to keep in the first browser speech segment.",
      "Second sentence is also safe and short enough to keep in another segment.",
      "Third sentence finishes the browser fallback playback."
    ].join(" ");

    const segments = splitBrowserSpeechSegments(text, 90);

    expect(segments).toEqual([
      {
        text: "First sentence is safe and short enough to keep in the first browser speech segment.",
        startOffset: 0,
        endOffset: 84
      },
      {
        text: "Second sentence is also safe and short enough to keep in another segment.",
        startOffset: 85,
        endOffset: 158
      },
      {
        text: "Third sentence finishes the browser fallback playback.",
        startOffset: 159,
        endOffset: 213
      }
    ]);
  });

  it("splits very long sentences without dropping words", () => {
    const text = `Intro. ${"word ".repeat(90)}Outro.`;

    const segments = splitBrowserSpeechSegments(text, 120);

    expect(segments.length).toBeGreaterThan(2);
    expect(segments.every((segment) => segment.text.length <= 120)).toBe(true);
    expect(segments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim()).toBe(
      text.replace(/\s+/g, " ").trim()
    );
  });
});
