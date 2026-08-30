import type { ExtensionSettings, ReadingChunk } from "../shared/types";

type HighlightMode = ExtensionSettings["highlightMode"];

export type HighlightPlaybackPosition = {
  currentTime?: number;
  duration?: number;
  characterOffset?: number;
  sentenceIndex?: number;
};

export type ActiveHighlightTarget = {
  selector?: string;
  selectors?: string[];
  text?: string;
  key: string;
};

type TextSegment = {
  text: string;
  selector?: string;
  start: number;
  end: number;
};

export function getActiveHighlightTarget(
  chunk: ReadingChunk,
  mode: HighlightMode,
  position: HighlightPlaybackPosition = {}
): ActiveHighlightTarget | null {
  if (mode === "none") return null;
  const paragraphs = getParagraphSegments(chunk);
  if (!paragraphs.length) return null;

  if (mode === "paragraph") {
    const paragraph = pickActiveSegment(paragraphs, position);
    return {
      selector: paragraph.selector ?? chunk.elementSelector,
      selectors: paragraph.selector ? [paragraph.selector] : chunk.elementSelectors,
      text: paragraph.text,
      key: `paragraph:${paragraph.selector ?? "chunk"}:${paragraph.start}:${paragraph.end}`
    };
  }

  const sentences = paragraphs.flatMap((paragraph) =>
    getSentenceSegments(paragraph.text, paragraph.start, paragraph.selector)
  );
  const indexedSentence = Number.isInteger(position.sentenceIndex) ? sentences[Number(position.sentenceIndex)] : undefined;
  const sentence = indexedSentence ?? pickActiveSegment(sentences.length ? sentences : paragraphs, position);
  return {
    selector: sentence.selector ?? chunk.elementSelector,
    selectors: sentence.selector ? [sentence.selector] : chunk.elementSelectors,
    text: sentence.text,
    key: `sentence:${sentence.selector ?? "chunk"}:${sentence.start}:${sentence.end}`
  };
}

function getParagraphSegments(chunk: ReadingChunk): TextSegment[] {
  const text = chunk.text.trim();
  if (!text) return [];
  const parts = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return [{ text, selector: chunk.elementSelector, start: 0, end: text.length }];
  }

  const selectors = chunk.elementSelectors ?? [];
  let searchFrom = 0;
  return parts.map((part, index) => {
    const start = Math.max(text.indexOf(part, searchFrom), searchFrom);
    const end = start + part.length;
    searchFrom = end;
    return {
      text: part,
      selector: selectors[index] ?? chunk.elementSelector,
      start,
      end
    };
  });
}

function getSentenceSegments(text: string, paragraphStart: number, selector?: string): TextSegment[] {
  const matches = Array.from(text.matchAll(/[^.!?]+(?:[.!?]+["')\]]*|$)/g));
  return matches
    .map((match) => {
      const raw = match[0] ?? "";
      const leadingWhitespace = raw.match(/^\s*/)?.[0].length ?? 0;
      const trimmed = raw.trim();
      const start = paragraphStart + (match.index ?? 0) + leadingWhitespace;
      return {
        text: trimmed,
        selector,
        start,
        end: start + trimmed.length
      };
    })
    .filter((segment) => segment.text.length > 0);
}

function pickActiveSegment(segments: TextSegment[], position: HighlightPlaybackPosition): TextSegment {
  if (!segments.length) throw new Error("Cannot pick an active segment from an empty list.");
  const characterOffset = position.characterOffset;
  if (Number.isFinite(characterOffset)) {
    const offset = Number(characterOffset);
    return segments.find((segment) => offset >= segment.start && offset <= segment.end) ?? segments.at(-1) ?? segments[0];
  }

  const duration = Number(position.duration ?? 0);
  const currentTime = Number(position.currentTime ?? 0);
  const ratio = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const totalWeight = segments.reduce((total, segment) => total + Math.max(segment.text.length, 1), 0);
  const targetWeight = totalWeight * ratio;
  let cumulative = 0;
  for (const segment of segments) {
    cumulative += Math.max(segment.text.length, 1);
    if (targetWeight <= cumulative) return segment;
  }
  return segments.at(-1) ?? segments[0];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
