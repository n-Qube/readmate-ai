import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdfTextBlocks, MAX_PDF_PAGES, MAX_PDF_TEXT_CHARS } from "./extractPdfText.js";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: vi.fn()
}));

const getDocument = vi.mocked(pdfjs.getDocument);

describe("extractPdfTextBlocks", () => {
  beforeEach(() => getDocument.mockReset());

  it("rejects non-PDF bytes before invoking PDF.js", async () => {
    await expect(extractPdfTextBlocks(new TextEncoder().encode("not a pdf"))).rejects.toThrow("valid PDF");
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("rejects a document over the page limit and destroys the loading task", async () => {
    const destroy = vi.fn(async () => undefined);
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: MAX_PDF_PAGES + 1 }), destroy } as never);

    await expect(extractPdfTextBlocks(new TextEncoder().encode("%PDF-1.7"))).rejects.toThrow("page limit");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("rejects cumulative extracted text over the limit", async () => {
    const destroy = vi.fn(async () => undefined);
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "x".repeat(MAX_PDF_TEXT_CHARS) }] }) })
      }),
      destroy
    } as never);

    await expect(extractPdfTextBlocks(new TextEncoder().encode("%PDF-1.7"))).rejects.toThrow("text exceeds");
    expect(destroy).toHaveBeenCalledOnce();
  });
});
