import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "@/types";
import { documentTitleFromFilename, normalizeUploadFilename, normalizeUploadedDocumentForDisplay } from "./upload-filename";

describe("upload filename normalization", () => {
  it("turns an iOS percent-encoded Word filename into readable text", () => {
    expect(normalizeUploadFilename("Company%20Profile-%20Don%20Emilio.docx")).toBe("Company Profile- Don Emilio.docx");
    expect(documentTitleFromFilename("Company%20Profile-%20Don%20Emilio.docx")).toBe("Company Profile- Don Emilio");
  });

  it("leaves ordinary filenames unchanged", () => {
    expect(documentTitleFromFilename("Lecture Notes.pdf")).toBe("Lecture Notes");
  });

  it("does not fail on malformed percent escapes", () => {
    expect(normalizeUploadFilename("100% ready.docx")).toBe("100% ready.docx");
  });

  it("removes path separators decoded from a filename", () => {
    expect(normalizeUploadFilename("Company%2FProfile.docx")).toBe("Company-Profile.docx");
  });

  it("cleans the title of an existing uploaded document for display", () => {
    const document = {
      title: "Company%20Profile-%20Don%20Emilio",
      sourceType: "document"
    } as ReadingDocument;
    expect(normalizeUploadedDocumentForDisplay(document).title).toBe("Company Profile- Don Emilio");
  });

  it("does not rewrite ordinary web article titles", () => {
    const document = { title: "Save 20%20 more", sourceType: "webpage" } as ReadingDocument;
    expect(normalizeUploadedDocumentForDisplay(document)).toBe(document);
  });
});
