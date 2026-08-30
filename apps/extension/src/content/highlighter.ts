import type { ExtensionSettings } from "../shared/types";

const CLASS_NAME = "readmate-current-highlight";
const STYLE_ID = "readmate-highlight-style";
const HIGHLIGHT_NAME = "readmate-current-sentence";
let currentRange: Range | null = null;

type HighlightConstructor = new (...ranges: Range[]) => Highlight;

type Highlight = {
  add: (range: Range) => void;
};

type HighlightRegistry = {
  delete: (name: string) => void;
  set: (name: string, highlight: Highlight) => void;
};

export function highlightChunk(selector: string | undefined, settings: ExtensionSettings, text?: string, selectors: string[] = []): void {
  clearHighlights();
  const targets = getTargets(selector, selectors);
  if (!targets.length || settings.highlightMode === "none") return;
  ensureStyle();
  if (settings.highlightMode === "sentence" && targets.length === 1 && text && highlightTextRange(targets[0], text)) {
    if (settings.autoScroll) {
      scrollRangeIntoView(targets[0]);
    }
    return;
  }
  targets.forEach((target) => target.classList.add(CLASS_NAME));
  if (settings.autoScroll) {
    targets[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function clearHighlights(): void {
  document.querySelectorAll(`.${CLASS_NAME}`).forEach((element) => element.classList.remove(CLASS_NAME));
  getHighlightRegistry()?.delete(HIGHLIGHT_NAME);
  currentRange = null;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background: rgba(250, 204, 21, 0.62);
      color: inherit;
    }
    .${CLASS_NAME} {
      background: linear-gradient(90deg, rgba(250, 204, 21, 0.45), rgba(45, 212, 191, 0.22));
      border-radius: 6px;
      box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.18);
      transition: background 180ms ease, box-shadow 180ms ease;
    }
  `;
  document.documentElement.appendChild(style);
}

function highlightTextRange(target: HTMLElement, text: string): boolean {
  const registry = getHighlightRegistry();
  const HighlightClass = getHighlightConstructor();
  if (!registry || !HighlightClass) return false;
  const range = findRangeForText(target, text);
  if (!range) return false;
  registry.set(HIGHLIGHT_NAME, new HighlightClass(range));
  currentRange = range;
  return true;
}

function findRangeForText(root: HTMLElement, text: string): Range | null {
  const needle = normalizeWhitespace(text);
  if (!needle) return null;

  const normalizedChars: string[] = [];
  const starts: Array<{ node: Text; offset: number }> = [];
  const ends: Array<{ node: Text; offset: number }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    for (let offset = 0; offset < textNode.data.length; offset += 1) {
      const char = textNode.data[offset] ?? "";
      const normalizedChar = /\s/.test(char) ? " " : char;
      if (normalizedChar === " " && normalizedChars.at(-1) === " ") continue;
      normalizedChars.push(normalizedChar);
      starts.push({ node: textNode, offset });
      ends.push({ node: textNode, offset: offset + 1 });
    }
    node = walker.nextNode();
  }

  const haystack = normalizedChars.join("");
  const leadingWhitespace = haystack.match(/^\s*/)?.[0].length ?? 0;
  const index = haystack.trim().indexOf(needle);
  if (index < 0) return null;

  const startIndex = leadingWhitespace + index;
  const endIndex = startIndex + needle.length - 1;
  const start = starts[startIndex];
  const end = ends[endIndex];
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function scrollRangeIntoView(fallback: HTMLElement): void {
  const rect = currentRange?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    window.scrollBy({ top: rect.top - window.innerHeight / 2, behavior: "smooth" });
    return;
  }
  fallback.scrollIntoView({ behavior: "smooth", block: "center" });
}

function getHighlightRegistry(): HighlightRegistry | undefined {
  return "highlights" in CSS ? (CSS.highlights as unknown as HighlightRegistry) : undefined;
}

function getHighlightConstructor(): HighlightConstructor | undefined {
  return "Highlight" in window ? (window.Highlight as unknown as HighlightConstructor) : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getTargets(selector: string | undefined, selectors: string[]): HTMLElement[] {
  const uniqueSelectors = Array.from(new Set([selector, ...selectors].filter(Boolean) as string[]));
  return uniqueSelectors
    .map((candidate) => document.querySelector<HTMLElement>(candidate))
    .filter((element): element is HTMLElement => Boolean(element));
}
