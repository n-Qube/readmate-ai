import type { ReadingChunk, SourceType } from "../shared/types";

const READABLE_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "li",
  "blockquote",
  "[data-ad-preview='message']",
  "[data-ad-comet-preview='message']",
  "[data-testid='post_message']",
  "[role='article'] [dir='auto']",
  ".a3s",
  ".gsc_oci_field",
  ".gsc_oci_value",
  ".gs_rt",
  ".gs_a",
  ".gs_rs",
  "[data-testid='tweetText']",
  "[data-test-id='main-feed-activity-card']",
  ".feed-shared-update-v2",
  ".feed-shared-update-v2__description-wrapper",
  ".feed-shared-text",
  ".update-components-text"
].join(",");
const BLOCKED_ANCESTOR_SELECTOR =
  [
    "nav",
    "aside",
    "footer",
    "header",
    "script",
    "style",
    "noscript",
    "template",
    "button",
    "form",
    "input",
    "textarea",
    "select",
    "[aria-hidden='true']",
    "[hidden]",
    "[role='navigation']",
    "[role='complementary']",
    "[role='banner']",
    "[role='contentinfo']",
    "[data-testid='sidebarColumn']",
    "[data-testid='placementTracking']",
    "[data-test-id='right-rail']",
    "[class*='ad-banner']",
    "[class*='advert']"
  ].join(",");
const MAX_CHUNK_CHARS = 7000;
const MAX_CANDIDATE_ROOTS = 64;
const MAX_VISITED_ELEMENTS = 10_000;
const MAX_TOTAL_TEXT_CHARS = 1_000_000;
const MAX_OUTPUT_CHUNKS = 250;
const EXTRACTION_TIME_BUDGET_MS = 250;
const SOCIAL_ROOT_SELECTOR = [
  "article[data-testid='tweet']",
  "[data-testid='tweetText']",
  "[data-urn^='urn:li:activity']",
  "[data-test-id='main-feed-activity-card']",
  ".feed-shared-update-v2",
  "[role='article']"
].join(",");

type ReadableBlock = {
  text: string;
  selector: string;
  tagName: string;
};

type ExtractionBudget = {
  deadline: number;
  visitedElements: number;
  totalTextChars: number;
};

export class ExtractionLimitError extends Error {
  constructor() {
    super("This page is too large for ReadMate to extract safely. Select a smaller passage and try again.");
    this.name = "ExtractionLimitError";
  }
}

export function extractReadableChunks(
  doc: Document = document,
  pageUrl = location.href,
  title = doc.title
): ReadingChunk[] {
  const budget: ExtractionBudget = {
    deadline: Date.now() + EXTRACTION_TIME_BUDGET_MS,
    visitedElements: 0,
    totalTextChars: 0
  };
  const metadata = extractPageMetadata(doc);
  const blocks = findBestReadableBlocks(doc, budget);

  const groups = groupReadableBlocks(blocks);
  if (groups.length > MAX_OUTPUT_CHUNKS) throw new ExtractionLimitError();
  return groups.map((group, index) => ({
    id: `webpage-${index}`,
    text: group.blocks.map((block) => block.text).join("\n\n"),
    sourceType: "webpage" as SourceType,
    pageUrl,
    title,
    ...metadata,
    elementSelector: group.blocks[0]?.selector,
    elementSelectors: group.blocks.map((block) => block.selector)
  }));
}

function findBestReadableBlocks(doc: Document, budget: ExtractionBudget): ReadableBlock[] {
  const candidates = getReadableRootCandidates(doc)
    .map((root) => ({ root, blocks: collectReadableBlocks(root, budget) }))
    .filter((candidate) => candidate.blocks.length > 0);
  if (!candidates.length) return [];

  let best = candidates[0];
  let bestScore = scoreReadableCandidate(best.root, best.blocks);
  for (const candidate of candidates.slice(1)) {
    const score = scoreReadableCandidate(candidate.root, candidate.blocks);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best.blocks;
}

function getReadableRootCandidates(doc: Document): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const candidates: HTMLElement[] = [];
  for (const selector of [SOCIAL_ROOT_SELECTOR, "article", "main", "[role='main']", ".a3s", "#gsc_oci_table", ".gs_r"]) {
    for (const root of doc.querySelectorAll<HTMLElement>(selector)) {
      if (seen.has(root)) continue;
      if (candidates.length >= MAX_CANDIDATE_ROOTS) throw new ExtractionLimitError();
      seen.add(root);
      candidates.push(root);
    }
  }
  if (doc.body && !seen.has(doc.body)) candidates.push(doc.body);
  return candidates;
}

function collectReadableBlocks(root: HTMLElement, budget: ExtractionBudget): ReadableBlock[] {
  const readableElements: HTMLElement[] = [];
  const blocks: ReadableBlock[] = [];
  const visit = (element: HTMLElement) => {
    budget.visitedElements += 1;
    assertExtractionBudget(budget);
    if (!isReadableElement(element) || hasReadableAncestorInSet(element, readableElements)) return;
    readableElements.push(element);
    const text = normalizeWhitespace(element.innerText || element.textContent || "");
    if (text.length < 8 || isBoilerplateText(text)) return;
    budget.totalTextChars += text.length;
    assertExtractionBudget(budget);
    blocks.push({ text, selector: getStableSelector(element), tagName: element.tagName.toLowerCase() });
  };

  if (root.matches(READABLE_SELECTOR)) visit(root);
  for (const element of root.querySelectorAll<HTMLElement>(READABLE_SELECTOR)) visit(element);
  return blocks;
}

function hasReadableAncestorInSet(element: HTMLElement, previousElements: HTMLElement[]): boolean {
  return previousElements.some((previous) => previous !== element && previous.contains(element));
}

function assertExtractionBudget(budget: ExtractionBudget): void {
  if (
    budget.visitedElements > MAX_VISITED_ELEMENTS ||
    budget.totalTextChars > MAX_TOTAL_TEXT_CHARS ||
    Date.now() > budget.deadline
  ) {
    throw new ExtractionLimitError();
  }
}

function scoreReadableCandidate(root: HTMLElement, blocks: ReadableBlock[]): number {
  const textScore = blocks.reduce((total, block) => total + block.text.length, 0) + blocks.length * 25;
  const hasBodyText = blocks.some((block) => !/^h[1-4]$/.test(block.tagName));
  if (!hasBodyText) return textScore - 5_000;
  if (root.matches(SOCIAL_ROOT_SELECTOR)) return textScore + 50_000;
  if (root.tagName.toLowerCase() === "article") return textScore + 2_000;
  if (root.tagName.toLowerCase() === "main") return textScore + 500;
  return textScore;
}

export function extractSelectedTextChunk(selection: string, pageUrl = location.href, title = document.title): ReadingChunk | null {
  return extractSelectedTextChunks(selection, pageUrl, title)[0] ?? null;
}

export function extractSelectedTextChunks(
  selection: Selection | string | null,
  pageUrl = location.href,
  title = document.title
): ReadingChunk[] {
  const text = normalizeWhitespace(typeof selection === "string" ? selection : selection?.toString() ?? "");
  if (!text) return [];
  if (text.length > MAX_TOTAL_TEXT_CHARS) throw new ExtractionLimitError();
  const selector = typeof selection === "string" ? undefined : getSelectionSelector(selection);
  const metadata = typeof document !== "undefined" ? extractPageMetadata(document) : {};
  const parts = splitLongText(text);
  if (parts.length > MAX_OUTPUT_CHUNKS) throw new ExtractionLimitError();
  return parts.map((part, index) => ({
    id: `selection-${index}`,
    text: part,
    sourceType: "selection" as SourceType,
    pageUrl,
    title,
    ...metadata,
    elementSelector: selector,
    elementSelectors: selector ? [selector] : undefined
  }));
}

function extractPageMetadata(doc: Document): Pick<ReadingChunk, "thumbnailUrl" | "author" | "description"> {
  const thumbnailUrl = metaContent(doc, "property", "og:image") ?? metaContent(doc, "name", "twitter:image");
  const author =
    metaContent(doc, "name", "author") ??
    metaContent(doc, "property", "article:author") ??
    doc.querySelector<HTMLElement>("[rel='author'], .author, .byline")?.innerText;
  const description =
    metaContent(doc, "name", "description") ??
    metaContent(doc, "property", "og:description") ??
    metaContent(doc, "name", "twitter:description");
  return {
    thumbnailUrl: thumbnailUrl ? absolutizeUrl(thumbnailUrl, doc.location?.href) : undefined,
    author: author ? normalizeWhitespace(author) : undefined,
    description: description ? normalizeWhitespace(description) : undefined
  };
}

function metaContent(doc: Document, attribute: "name" | "property", value: string): string | undefined {
  return doc.querySelector<HTMLMetaElement>(`meta[${attribute}="${escapeAttributeValue(value)}"]`)?.content?.trim() || undefined;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function absolutizeUrl(value: string, baseUrl: string | undefined): string | undefined {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function groupReadableBlocks(blocks: ReadableBlock[]): Array<{ blocks: ReadableBlock[] }> {
  const groups: Array<{ blocks: ReadableBlock[] }> = [];
  let current: ReadableBlock[] = [];
  let currentLength = 0;

  for (const block of blocks) {
    const isHeading = /^h[1-4]$/.test(block.tagName);
    const projectedLength = currentLength + block.text.length + (current.length ? 2 : 0);

    if (current.length && (projectedLength > MAX_CHUNK_CHARS || (isHeading && current.some((item) => !/^h[1-4]$/.test(item.tagName))))) {
      groups.push({ blocks: current });
      current = [];
      currentLength = 0;
    }

    if (block.text.length > MAX_CHUNK_CHARS) {
      splitLongText(block.text).forEach((part, index) => {
        const splitBlock = { ...block, text: part };
        if (index === 0 && current.length) {
          groups.push({ blocks: [...current, splitBlock] });
          current = [];
          currentLength = 0;
          return;
        }
        groups.push({ blocks: [splitBlock] });
      });
      continue;
    }

    current.push(block);
    currentLength += block.text.length + (current.length > 1 ? 2 : 0);
  }

  if (current.length) groups.push({ blocks: current });
  return groups;
}

function splitLongText(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= MAX_CHUNK_CHARS) return [normalized];

  const sentences = normalized.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)?.map(normalizeWhitespace).filter(Boolean) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    if (sentence.length > MAX_CHUNK_CHARS) {
      for (let index = 0; index < sentence.length; index += MAX_CHUNK_CHARS) {
        chunks.push(sentence.slice(index, index + MAX_CHUNK_CHARS));
      }
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }

  if (current) chunks.push(current);
  return chunks;
}

function isReadableElement(element: HTMLElement): boolean {
  if (element.closest(BLOCKED_ANCESTOR_SELECTOR)) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.textContent !== null;
}

function isBoilerplateText(text: string): boolean {
  return /^(advertisement|ad feedback|sign in|subscribe|promoted|sponsored|who to follow|trending now)$/i.test(text);
}

function getStableSelector(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${escapeAttributeValue(testId)}"]`;
  const testIdAlt = element.getAttribute("data-test-id");
  if (testIdAlt) return `[data-test-id="${escapeAttributeValue(testIdAlt)}"]`;
  const urn = element.getAttribute("data-urn");
  if (urn) return `[data-urn="${escapeAttributeValue(urn)}"]`;
  const className = Array.from(element.classList).find(Boolean);
  if (className) return `${element.tagName.toLowerCase()}.${cssEscape(className)}`;

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTagSiblings = Array.from(parent.children).filter(
      (child): child is Element => child instanceof Element && child.tagName === current?.tagName
    );
    const index = sameTagSiblings.indexOf(current) + 1;
    parts.unshift(sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    current = parent;
  }
  return parts.join(" > ");
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getSelectionSelector(selection: Selection | null): string | undefined {
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const commonAncestor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!(commonAncestor instanceof Element)) return undefined;
  const readableAncestor = commonAncestor.closest(READABLE_SELECTOR);
  return getStableSelector(readableAncestor ?? commonAncestor);
}
