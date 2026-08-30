import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "./types";
import { normalizePercentEncodedText, normalizeUploadedDocumentForDisplay, normalizeUploadedDocumentsForDisplay } from "./documentDisplay";

describe("uploaded document display", () => {
  it("decodes a percent-encoded Word document title", () => {
    const document = {
      title: "Company%20Profile-%20Don%20Emilio",
      sourceType: "document"
    } as ReadingDocument;

    expect(normalizeUploadedDocumentForDisplay(document).title).toBe("Company Profile- Don Emilio");
  });

  it("cleans encoded control characters from uploaded titles", () => {
    expect(normalizePercentEncodedText("Lecture%0ANotes")).toBe("Lecture Notes");
  });

  it("keeps malformed percent escapes usable", () => {
    expect(normalizePercentEncodedText("100% ready%2")).toBe("100% ready%2");
  });

  it("does not rewrite an ordinary webpage headline", () => {
    const document = {
      title: "Save 20%20 more",
      sourceType: "webpage"
    } as ReadingDocument;

    expect(normalizeUploadedDocumentForDisplay(document)).toBe(document);
  });

  it("normalizes uploaded titles at a mixed history-state boundary", () => {
    const uploaded = { title: "Company%20Profile", sourceType: "document" } as ReadingDocument;
    const webpage = { title: "Save 20%20 more", sourceType: "webpage" } as ReadingDocument;

    const result = normalizeUploadedDocumentsForDisplay([uploaded, webpage]);

    expect(result.map((item) => item.title)).toEqual(["Company Profile", "Save 20%20 more"]);
    expect(result[1]).toBe(webpage);
  });
});
