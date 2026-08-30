export type BrowserSpeechSegment = {
  text: string;
  startOffset: number;
  endOffset: number;
};

export const MAX_BROWSER_SPEECH_SEGMENT_CHARS = 900;

export function splitBrowserSpeechSegments(
  text: string,
  maxChars = MAX_BROWSER_SPEECH_SEGMENT_CHARS
): BrowserSpeechSegment[] {
  if (!Number.isFinite(maxChars) || maxChars < 80) {
    throw new Error("Browser speech segment size must be at least 80 characters.");
  }

  const trimmedStart = text.search(/\S/);
  if (trimmedStart === -1) return [];
  const trimmedEnd = text.search(/\s*$/);
  const sourceStart = Math.max(trimmedStart, 0);
  const sourceEnd = trimmedEnd >= 0 ? trimmedEnd : text.length;
  const source = text.slice(sourceStart, sourceEnd);
  const pieces = sentencePieces(source, sourceStart);
  const segments: BrowserSpeechSegment[] = [];
  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  const flush = () => {
    if (currentStart === null || currentEnd === null) return;
    const segment = trimSegment(text, currentStart, currentEnd);
    if (segment) segments.push(segment);
    currentStart = null;
    currentEnd = null;
  };

  for (const piece of pieces) {
    if (piece.endOffset - piece.startOffset > maxChars) {
      flush();
      segments.push(...splitLongPiece(text, piece.startOffset, piece.endOffset, maxChars));
      continue;
    }

    if (currentStart === null || currentEnd === null) {
      currentStart = piece.startOffset;
      currentEnd = piece.endOffset;
      continue;
    }

    if (piece.endOffset - currentStart <= maxChars) {
      currentEnd = piece.endOffset;
      continue;
    }

    flush();
    currentStart = piece.startOffset;
    currentEnd = piece.endOffset;
  }

  flush();
  return segments;
}

function sentencePieces(text: string, offset: number): BrowserSpeechSegment[] {
  const matches = Array.from(text.matchAll(/[^.!?]+(?:[.!?]+["')\]]*|$)/g));
  const pieces = matches
    .map((match) => {
      const raw = match[0] ?? "";
      const rawStart = offset + (match.index ?? 0);
      return trimSegment(text, rawStart - offset, rawStart - offset + raw.length, offset);
    })
    .filter((segment): segment is BrowserSpeechSegment => Boolean(segment));

  return pieces.length ? pieces : [trimSegment(text, 0, text.length, offset)].filter(Boolean) as BrowserSpeechSegment[];
}

function splitLongPiece(text: string, startOffset: number, endOffset: number, maxChars: number): BrowserSpeechSegment[] {
  const segments: BrowserSpeechSegment[] = [];
  let start = startOffset;
  while (start < endOffset) {
    let end = Math.min(start + maxChars, endOffset);
    const searchWindow = text.slice(start, end);
    const lastWhitespace = searchWindow.search(/\s+\S*$/);
    if (end < endOffset && lastWhitespace > Math.floor(maxChars * 0.55)) {
      end = start + lastWhitespace;
    }
    const segment = trimSegment(text, start, end);
    if (segment) segments.push(segment);
    start = Math.max(end, start + 1);
  }
  return segments;
}

function trimSegment(text: string, startOffset: number, endOffset: number, baseOffset = 0): BrowserSpeechSegment | null {
  const raw = text.slice(startOffset, endOffset);
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
  const start = baseOffset + startOffset + leading;
  const end = baseOffset + endOffset - trailing;
  if (end <= start) return null;
  return {
    text: text.slice(startOffset + leading, endOffset - trailing),
    startOffset: start,
    endOffset: end
  };
}
