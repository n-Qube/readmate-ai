/**
 * Split text into provider-sized requests on sentence boundaries, falling back
 * to word and then code-point boundaries so no request exceeds `maxBytes`.
 */
export function splitTextForSpeech(text: string, maxBytes: number): string[] {
  const fits = (value: string) => Buffer.byteLength(value, "utf8") <= maxBytes;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (fits(normalized)) return [normalized];

  const parts: string[] = [];
  let current = "";
  for (const sentence of normalized.split(/(?<=[.!?])\s+/)) {
    if (!sentence) continue;
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) {
      parts.push(current);
      current = "";
    }
    if (fits(sentence)) {
      current = sentence;
      continue;
    }
    parts.push(...splitOversizedText(sentence, fits));
  }
  if (current) parts.push(current);
  return parts;
}

function splitOversizedText(text: string, fits: (value: string) => boolean): string[] {
  const parts: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    if (fits(word)) {
      current = word;
    } else {
      parts.push(...splitOversizedToken(word, fits));
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts;
}

function splitOversizedToken(text: string, fits: (value: string) => boolean): string[] {
  const parts: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let low = offset + 1;
    let high = text.length;
    let end = low;
    while (low <= high) {
      let midpoint = Math.floor((low + high) / 2);
      const previous = text.charCodeAt(midpoint - 1);
      const next = text.charCodeAt(midpoint);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) midpoint += 1;
      if (fits(text.slice(offset, midpoint))) {
        end = midpoint;
        low = midpoint + 1;
      } else {
        high = midpoint - 1;
      }
    }
    parts.push(text.slice(offset, end));
    offset = end;
  }
  return parts;
}
