export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 2_000;
export const MAX_PDF_TEXT_CHARS = 10_000_000;
export const MAX_PDF_TEXT_ITEMS = 1_000_000;

export function assertPdfByteSize(size: number): void {
  if (size > MAX_PDF_BYTES) throw new Error("PDF is too large to read.");
}

export function assertPdfPageCount(pageCount: number): void {
  if (pageCount > MAX_PDF_PAGES) throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit.`);
}

export function assertPdfTextBudget(totalChars: number, totalItems: number): void {
  if (totalItems > MAX_PDF_TEXT_ITEMS) throw new Error("PDF contains too many text items.");
  if (totalChars > MAX_PDF_TEXT_CHARS) throw new Error("PDF text exceeds the extraction limit.");
}
