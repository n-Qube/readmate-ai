/**
 * Pick the web link out of content shared from another app. Browsers send the
 * URL directly; many apps send "Title https://…" as plain text instead.
 */
export function extractSharedUrl(input: { webUrl?: string | null; text?: string | null }): string | null {
  const candidates = [input.webUrl, ...(input.text?.match(/https?:\/\/[^\s<>"]+/gi) ?? [])];
  for (const candidate of candidates) {
    const cleaned = candidate?.trim().replace(/[)\].,;:!?'"]+$/, "");
    if (!cleaned) continue;
    try {
      const url = new URL(cleaned);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      // Not a URL; try the next candidate.
    }
  }
  return null;
}
