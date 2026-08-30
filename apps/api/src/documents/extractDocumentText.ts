import JSZip from "jszip";
import { extractPdfTextBlocks } from "../pdf/extractPdfText.js";

const MAX_ZIP_ENTRIES = 256;
const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 100;

export type ExtractedDocumentBlock = {
  orderIndex: number;
  blockType: "page";
  text: string;
  sourcePageNumber: number;
};

export type SupportedDocumentKind = "pdf" | "epub" | "docx" | "doc" | "txt" | "markdown" | "rtf";

export type SupportedDocumentInfo = {
  kind: SupportedDocumentKind;
  mimeType: string;
  label: string;
};

export type DocumentExtractionLimits = {
  maxPages?: number;
  maxTextChars?: number;
};

export function supportedDocumentInfo(filename: string, mimeType?: string): SupportedDocumentInfo {
  const normalizedMime = mimeType?.toLowerCase().split(";")[0].trim();
  const lowerName = filename.toLowerCase();
  if (normalizedMime === "application/pdf" || lowerName.endsWith(".pdf")) {
    return { kind: "pdf", mimeType: "application/pdf", label: "PDF" };
  }
  if (normalizedMime === "application/epub+zip" || lowerName.endsWith(".epub")) {
    return { kind: "epub", mimeType: "application/epub+zip", label: "EPUB" };
  }
  if (
    normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    return {
      kind: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      label: "DOCX"
    };
  }
  if (normalizedMime === "application/msword" || lowerName.endsWith(".doc")) {
    return { kind: "doc", mimeType: "application/msword", label: "DOC" };
  }
  if (normalizedMime === "text/plain" || lowerName.endsWith(".txt")) {
    return { kind: "txt", mimeType: "text/plain", label: "text" };
  }
  if (normalizedMime === "text/markdown" || normalizedMime === "text/x-markdown" || lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return { kind: "markdown", mimeType: "text/markdown", label: "Markdown" };
  }
  if (normalizedMime === "application/rtf" || normalizedMime === "text/rtf" || lowerName.endsWith(".rtf")) {
    return { kind: "rtf", mimeType: "application/rtf", label: "RTF" };
  }
  if (lowerName.endsWith(".pub")) {
    throw new Error("Microsoft Publisher .pub files are not supported yet. Export the Publisher file to PDF, then upload the PDF.");
  }
  throw new Error("Upload a PDF, EPUB, DOCX, DOC, TXT, Markdown, or RTF document.");
}

export async function extractDocumentTextBlocks(bytes: Uint8Array, info: SupportedDocumentInfo, limits: DocumentExtractionLimits = {}): Promise<ExtractedDocumentBlock[]> {
  const blocks = info.kind === "pdf"
    ? await extractPdfTextBlocks(bytes, { maxPages: limits.maxPages, maxTextChars: limits.maxTextChars })
    : info.kind === "docx"
      ? await extractDocxTextBlocks(bytes)
      : info.kind === "doc"
        ? await extractLegacyDocTextBlocks(bytes)
        : info.kind === "txt" || info.kind === "markdown"
          ? extractPlainTextBlocks(bytes)
          : info.kind === "rtf"
            ? extractRtfTextBlocks(bytes)
            : await extractEpubTextBlocks(bytes);
  enforceDocumentExtractionLimits(blocks, limits);
  return blocks;
}

export function enforceDocumentExtractionLimits(blocks: ExtractedDocumentBlock[], limits: DocumentExtractionLimits): void {
  if (limits.maxPages && blocks.some((block) => block.sourcePageNumber > limits.maxPages!)) {
    throw new Error(`Document exceeds the ${limits.maxPages}-page limit.`);
  }
  const textCharacters = blocks.reduce((total, block) => total + block.text.length, 0);
  if (limits.maxTextChars && textCharacters > limits.maxTextChars) {
    throw new Error(`Document text exceeds the ${limits.maxTextChars}-character limit.`);
  }
}

async function extractDocxTextBlocks(bytes: Uint8Array): Promise<ExtractedDocumentBlock[]> {
  const zip = await loadBoundedZip(bytes);
  const state = { totalBytes: 0 };
  const documentXml = await readZipText(zip, "word/document.xml", state);
  if (!documentXml) throw new Error("This DOCX file is missing readable document text.");

  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => textFromXml(match[0], /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .filter(Boolean);

  return paragraphsToBlocks(paragraphs, 16);
}

async function extractEpubTextBlocks(bytes: Uint8Array): Promise<ExtractedDocumentBlock[]> {
  const zip = await loadBoundedZip(bytes);
  const state = { totalBytes: 0 };
  const rootFile = await epubRootFile(zip, state);
  const opf = rootFile ? await readZipText(zip, rootFile, state) : undefined;
  const spineFiles = opf && rootFile ? epubSpineFiles(opf, rootFile) : [];
  const htmlFiles = spineFiles.length ? spineFiles : Object.keys(zip.files).filter((path) => /\.(xhtml|html?)$/i.test(path));
  const paragraphs: string[] = [];

  for (const filePath of htmlFiles) {
    const file = zip.file(filePath);
    if (!file) continue;
    const html = await readZipText(zip, filePath, state);
    if (html === undefined) continue;
    paragraphs.push(...htmlToParagraphs(html));
  }

  return paragraphsToBlocks(paragraphs, 10);
}

async function extractLegacyDocTextBlocks(bytes: Uint8Array): Promise<ExtractedDocumentBlock[]> {
  const imported = await import("word-extractor");
  const WordExtractor = imported.default;
  const extractor = new WordExtractor();
  const document = await extractor.extract(Buffer.from(bytes));
  const text = document.getBody().replace(/\r/g, "\n");
  const paragraphs = text
    .split(/\n+/)
    .map((paragraph: string) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph: string) => paragraph.length > 0);
  return paragraphsToBlocks(paragraphs, 16);
}

function extractPlainTextBlocks(bytes: Uint8Array): ExtractedDocumentBlock[] {
  const text = decodeTextBytes(bytes);
  const paragraphs = textToParagraphs(text);
  return paragraphsToBlocks(paragraphs, 18);
}

function extractRtfTextBlocks(bytes: Uint8Array): ExtractedDocumentBlock[] {
  const source = decodeTextBytes(bytes);
  const text = source
    .replace(/\\'[0-9a-f]{2}/gi, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
    .replace(/\\par[d]?|\\line/gi, "\n")
    .replace(/\\tab/gi, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, " ")
    .replace(/[{}]/g, " ");
  return paragraphsToBlocks(textToParagraphs(text), 18);
}

async function epubRootFile(zip: JSZip, state: ZipReadState): Promise<string | undefined> {
  const container = await readZipText(zip, "META-INF/container.xml", state);
  return container?.match(/<rootfile\b[^>]*full-path="([^"]+)"/i)?.[1];
}

type ZipReadState = { totalBytes: number };
type ZipMetadata = { compressedSize: number; uncompressedSize: number };
type ZipObjectWithMetadata = JSZip.JSZipObject & { _data?: ZipMetadata };

async function loadBoundedZip(bytes: Uint8Array): Promise<JSZip> {
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const entryCount = Object.values(zip.files).filter((file) => !file.dir).length;
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error(`Archive contains too many files (maximum ${MAX_ZIP_ENTRIES}).`);
  return zip;
}

async function readZipText(zip: JSZip, path: string, state: ZipReadState): Promise<string | undefined> {
  const file = zip.file(path) as ZipObjectWithMetadata | null;
  if (!file || file.dir) return undefined;
  const metadata = file._data;
  if (!metadata || !Number.isFinite(metadata.uncompressedSize) || !Number.isFinite(metadata.compressedSize)) {
    throw new Error("Archive entry metadata is unavailable.");
  }
  if (metadata.uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error("Archive entry is too large.");
  if (metadata.compressedSize > 0 && metadata.uncompressedSize / metadata.compressedSize > MAX_ZIP_COMPRESSION_RATIO) {
    throw new Error("Archive entry compression ratio is too high.");
  }
  if (state.totalBytes + metadata.uncompressedSize > MAX_ZIP_TOTAL_BYTES) throw new Error("Archive expands beyond the extraction limit.");
  const text = await file.async("string");
  state.totalBytes += Buffer.byteLength(text, "utf8");
  if (state.totalBytes > MAX_ZIP_TOTAL_BYTES) throw new Error("Archive expands beyond the extraction limit.");
  return text;
}

function epubSpineFiles(opf: string, rootFile: string): string[] {
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = tag.match(/\bid="([^"]+)"/i)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    const mediaType = tag.match(/\bmedia-type="([^"]+)"/i)?.[1] ?? "";
    if (id && href && /xhtml|html/i.test(mediaType)) manifest.set(id, href);
  }

  const basePath = rootFile.includes("/") ? rootFile.slice(0, rootFile.lastIndexOf("/") + 1) : "";
  return [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)]
    .map((match) => manifest.get(match[1]))
    .filter((href): href is string => Boolean(href))
    .map((href) => normalizeZipPath(`${basePath}${href}`));
}

function htmlToParagraphs(html: string): string[] {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return body
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map(decodeXml)
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
}

function textToParagraphs(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "\n")
    .split(/\n{2,}|(?<=\.)\s{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

function decodeTextBytes(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const utf8 = buffer.toString("utf8");
  const replacementRatio = utf8.length ? (utf8.match(/\uFFFD/g)?.length ?? 0) / utf8.length : 0;
  return replacementRatio > 0.05 ? buffer.toString("latin1") : utf8;
}

function textFromXml(xml: string, pattern: RegExp): string {
  return [...xml.matchAll(pattern)]
    .map((match) => decodeXml(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function paragraphsToBlocks(paragraphs: string[], paragraphsPerBlock: number): ExtractedDocumentBlock[] {
  const blocks: ExtractedDocumentBlock[] = [];
  for (let index = 0; index < paragraphs.length; index += paragraphsPerBlock) {
    const text = paragraphs.slice(index, index + paragraphsPerBlock).join("\n\n").trim();
    if (!text) continue;
    blocks.push({
      orderIndex: blocks.length,
      blockType: "page",
      text,
      sourcePageNumber: blocks.length + 1
    });
  }
  return blocks;
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
