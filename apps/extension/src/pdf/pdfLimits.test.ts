import { describe, expect, it } from "vitest";
import { assertPdfByteSize, assertPdfPageCount, assertPdfTextBudget, MAX_PDF_BYTES, MAX_PDF_PAGES, MAX_PDF_TEXT_CHARS, MAX_PDF_TEXT_ITEMS } from "./pdfLimits";

describe("PDF resource limits", () => {
  it("accepts values at the documented limits", () => {
    expect(() => assertPdfByteSize(MAX_PDF_BYTES)).not.toThrow();
    expect(() => assertPdfPageCount(MAX_PDF_PAGES)).not.toThrow();
    expect(() => assertPdfTextBudget(MAX_PDF_TEXT_CHARS, MAX_PDF_TEXT_ITEMS)).not.toThrow();
  });

  it("rejects oversized bytes, pages, and extracted text", () => {
    expect(() => assertPdfByteSize(MAX_PDF_BYTES + 1)).toThrow("too large");
    expect(() => assertPdfPageCount(MAX_PDF_PAGES + 1)).toThrow("page limit");
    expect(() => assertPdfTextBudget(MAX_PDF_TEXT_CHARS + 1, 0)).toThrow("text exceeds");
    expect(() => assertPdfTextBudget(0, MAX_PDF_TEXT_ITEMS + 1)).toThrow("text items");
  });
});
