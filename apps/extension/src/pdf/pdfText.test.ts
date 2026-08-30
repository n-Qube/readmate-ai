import { describe, expect, it, vi } from "vitest";
import { fileFromPdfResponse } from "./pdfDownload";
import { MAX_PDF_BYTES } from "./pdfLimits";

describe("bounded PDF download", () => {
  it("rejects an oversized response from its content length", async () => {
    const response = new Response(null, { headers: { "content-length": String(MAX_PDF_BYTES + 1) } });
    await expect(fileFromPdfResponse(response, "large.pdf")).rejects.toThrow("too large");
  });

  it("reads a small streamed response into a File", async () => {
    const onProgress = vi.fn();
    const response = new Response(new Uint8Array([37, 80, 68, 70, 45]), {
      headers: { "content-type": "application/pdf", "content-length": "5" }
    });
    const file = await fileFromPdfResponse(response, "small.pdf", { onProgress });
    expect(file.name).toBe("small.pdf");
    expect(file.size).toBe(5);
    expect(file.type).toBe("application/pdf");
    expect(onProgress).toHaveBeenNthCalledWith(1, { loadedBytes: 0, totalBytes: 5 });
    expect(onProgress).toHaveBeenLastCalledWith({ loadedBytes: 5, totalBytes: 5 });
  });

  it("stops before reading when the download is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = new Response(new Uint8Array([37, 80, 68, 70, 45]));

    await expect(fileFromPdfResponse(response, "cancelled.pdf", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
