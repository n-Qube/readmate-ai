import { assertPdfByteSize, MAX_PDF_BYTES } from "./pdfLimits";

export type PdfDownloadProgress = {
  loadedBytes: number;
  totalBytes: number;
};

export type PdfDownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: PdfDownloadProgress) => void;
};

export async function fileFromPdfResponse(response: Response, filename: string, options: PdfDownloadOptions = {}): Promise<File> {
  throwIfAborted(options.signal);
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength ? Number(contentLength) : 0;
  if (Number.isFinite(declaredLength) && declaredLength > 0) assertPdfByteSize(declaredLength);
  const declaredTotalBytes = Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : 0;
  options.onProgress?.({ loadedBytes: 0, totalBytes: declaredTotalBytes });
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    throwIfAborted(options.signal);
    assertPdfByteSize(bytes.byteLength);
    options.onProgress?.({ loadedBytes: bytes.byteLength, totalBytes: declaredTotalBytes || bytes.byteLength });
    return new File([bytes], filename, { type: response.headers.get("content-type") || "application/pdf" });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", cancelReader, { once: true });
  try {
    while (true) {
      throwIfAborted(options.signal);
      const result = await reader.read();
      if (result.done) break;
      downloadedBytes += result.value.byteLength;
      if (downloadedBytes > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new Error("PDF is too large to read.");
      }
      chunks.push(result.value);
      options.onProgress?.({ loadedBytes: downloadedBytes, totalBytes: declaredTotalBytes });
    }
    throwIfAborted(options.signal);
  } finally {
    options.signal?.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
  options.onProgress?.({ loadedBytes: downloadedBytes, totalBytes: declaredTotalBytes || downloadedBytes });
  return new File(chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer), filename, { type: response.headers.get("content-type") || "application/pdf" });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}
