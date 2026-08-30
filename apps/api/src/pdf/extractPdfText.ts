import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_PDF_PAGES = 2_000;
export const MAX_PDF_TEXT_CHARS = 10_000_000;
export const MAX_PDF_TEXT_ITEMS = 1_000_000;

export type ExtractedPdfBlock = {
  orderIndex: number;
  blockType: "page";
  text: string;
  sourcePageNumber: number;
};

export type PdfExtractionLimits = {
  maxPages?: number;
  maxTextChars?: number;
  maxTextItems?: number;
};

export async function extractPdfTextBlocks(bytes: Uint8Array, limits: PdfExtractionLimits = {}): Promise<ExtractedPdfBlock[]> {
  if (!isPdfBytes(bytes)) throw new Error("The uploaded file is not a valid PDF.");
  const maxPages = boundedLimit(limits.maxPages, MAX_PDF_PAGES);
  const maxTextChars = boundedLimit(limits.maxTextChars, MAX_PDF_TEXT_CHARS);
  const maxTextItems = boundedLimit(limits.maxTextItems, MAX_PDF_TEXT_ITEMS);

  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const blocks: ExtractedPdfBlock[] = [];
  let totalTextChars = 0;
  let totalTextItems = 0;

  try {
    if (pdf.numPages > maxPages) throw new Error(`PDF exceeds the ${maxPages}-page limit.`);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      totalTextItems += textContent.items.length;
      if (totalTextItems > maxTextItems) throw new Error("PDF contains too many text items.");
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      totalTextChars += text.length;
      if (totalTextChars > maxTextChars) throw new Error("PDF text exceeds the extraction limit.");

      if (text) {
        blocks.push({
          orderIndex: blocks.length,
          blockType: "page",
          text,
          sourcePageNumber: pageNumber
        });
      }
    }
    return blocks;
  } finally {
    await loadingTask.destroy();
  }
}

function boundedLimit(configured: number | undefined, absoluteMaximum: number): number {
  return Number.isSafeInteger(configured) && Number(configured) > 0 ? Math.min(Number(configured), absoluteMaximum) : absoluteMaximum;
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  const scanLength = Math.min(bytes.byteLength, 1024);
  for (let index = 0; index <= scanLength - 5; index += 1) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x50 && bytes[index + 2] === 0x44 && bytes[index + 3] === 0x46 && bytes[index + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}
