export function isLikelyPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith(".pdf") || /\.pdf(?:$|[?#])/i.test(parsed.href);
  } catch {
    return false;
  }
}

const CHROME_PDF_VIEWER_IDS = new Set([
  "efaidnbmnnnibpcajpcglclefindmkaj",
  "mhjfbmdgcfjbbpaeojofohoefgiehjai"
]);

/**
 * Chrome's built-in PDF viewer does not accept content-script injection. The
 * tab API still exposes the original HTTP(S) URL, so resolve that URL before
 * the normal page-reader path runs.
 */
export function pdfSourceUrlFromTab(tab: chrome.tabs.Tab | undefined): string | undefined {
  const url = tab?.url?.trim();
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) {
    if (isLikelyPdfUrl(url) || /\.pdf(?:$|\s)/i.test(tab?.title ?? "")) return url;
    return undefined;
  }

  const embedded = sourceUrlFromChromePdfViewer(url);
  if (embedded && (isLikelyPdfUrl(embedded) || /\.pdf(?:$|\s)/i.test(tab?.title ?? ""))) return embedded;
  return undefined;
}

function sourceUrlFromChromePdfViewer(viewerUrl: string): string | undefined {
  try {
    const parsed = new URL(viewerUrl);
    if (parsed.protocol !== "chrome-extension:" || !CHROME_PDF_VIEWER_IDS.has(parsed.hostname)) return undefined;
    const candidates = [
      parsed.searchParams.get("file"),
      new URLSearchParams(parsed.hash.replace(/^#/, "")).get("file"),
      parsed.pathname.replace(/^\//, "")
    ];
    for (const value of candidates) {
      const decoded = decodePdfViewerValue(value);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function decodePdfViewerValue(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}
