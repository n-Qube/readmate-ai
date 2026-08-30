import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDocumentTextBlocks, supportedDocumentInfo } from "./extractDocumentText.js";

describe("bounded ZIP document extraction", () => {
  it("extracts a normal DOCX entry", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:document>");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractDocumentTextBlocks(bytes, supportedDocumentInfo("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).resolves.toEqual([
      expect.objectContaining({ text: "Hello" })
    ]);
  });

  it("rejects a DOCX entry whose declared expansion exceeds the limit", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "x".repeat(9 * 1024 * 1024));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    await expect(extractDocumentTextBlocks(bytes, supportedDocumentInfo("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).rejects.toThrow("entry is too large");
  });
});
