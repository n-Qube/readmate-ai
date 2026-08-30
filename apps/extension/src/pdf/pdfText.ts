import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { ReadingChunk } from "../shared/types";
import { assertPdfByteSize, assertPdfPageCount, assertPdfTextBudget } from "./pdfLimits";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfChunkMetadata = {
  title?: string;
  pageUrl?: string;
};

export async function extractPdfChunks(file: File, metadata: PdfChunkMetadata = {}): Promise<ReadingChunk[]> {
  assertPdfByteSize(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const chunks: ReadingChunk[] = [];
  let totalTextChars = 0;
  let totalTextItems = 0;

  try {
    assertPdfPageCount(pdf.numPages);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      totalTextItems += textContent.items.length;
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      totalTextChars += text.length;
      assertPdfTextBudget(totalTextChars, totalTextItems);
      if (text) {
        chunks.push({
          id: `pdf-${pageNumber}`,
          text,
          sourceType: "pdf",
          title: metadata.title ?? file.name,
          pageUrl: metadata.pageUrl,
          pageNumber
        });
      }
    }
    return chunks;
  } finally {
    await loadingTask.destroy();
  }
}
