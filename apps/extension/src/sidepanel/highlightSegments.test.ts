import { describe, expect, it } from "vitest";
import { getActiveHighlightTarget } from "./highlightSegments";
import type { ReadingChunk } from "../shared/types";

const chunk: ReadingChunk = {
  id: "chunk-1",
  sourceType: "webpage",
  text: [
    "First paragraph first sentence. First paragraph second sentence.",
    "Second paragraph first sentence. Second paragraph second sentence."
  ].join("\n\n"),
  elementSelector: "article p:nth-of-type(1)",
  elementSelectors: ["article p:nth-of-type(1)", "article p:nth-of-type(2)"]
};

describe("getActiveHighlightTarget", () => {
  it("returns the active paragraph and selector for paragraph highlighting", () => {
    expect(getActiveHighlightTarget(chunk, "paragraph", { currentTime: 0, duration: 10 })).toMatchObject({
      selector: "article p:nth-of-type(1)",
      selectors: ["article p:nth-of-type(1)"],
      text: "First paragraph first sentence. First paragraph second sentence."
    });

    expect(getActiveHighlightTarget(chunk, "paragraph", { currentTime: 8, duration: 10 })).toMatchObject({
      selector: "article p:nth-of-type(2)",
      selectors: ["article p:nth-of-type(2)"],
      text: "Second paragraph first sentence. Second paragraph second sentence."
    });
  });

  it("returns only the active sentence for sentence highlighting", () => {
    expect(getActiveHighlightTarget(chunk, "sentence", { characterOffset: 10 })).toMatchObject({
      selector: "article p:nth-of-type(1)",
      text: "First paragraph first sentence."
    });

    expect(getActiveHighlightTarget(chunk, "sentence", { characterOffset: 76 })).toMatchObject({
      selector: "article p:nth-of-type(2)",
      text: "Second paragraph first sentence."
    });
  });

  it("uses a stored sentence index when one is available", () => {
    expect(getActiveHighlightTarget(chunk, "sentence", { sentenceIndex: 3 })).toMatchObject({
      selector: "article p:nth-of-type(2)",
      text: "Second paragraph second sentence."
    });
  });

  it("returns no target when highlighting is disabled", () => {
    expect(getActiveHighlightTarget(chunk, "none", { currentTime: 1, duration: 10 })).toBeNull();
  });
});
