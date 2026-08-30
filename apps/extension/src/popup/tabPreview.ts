export type PopupTabPreview = {
  domain: string;
  faviconUrl?: string;
  initial: string;
  readable: boolean;
  title: string;
};

const unsupportedPreview: PopupTabPreview = {
  domain: "Chrome page",
  initial: "R",
  readable: false,
  title: "Open a readable web page"
};

export async function getActiveTabPreview(): Promise<PopupTabPreview> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab || !isReadableUrl(tab.url)) {
    return unsupportedPreview;
  }

  const domain = formatDomain(tab.url);
  return {
    domain,
    faviconUrl: tab.favIconUrl,
    initial: getDomainInitial(domain),
    readable: true,
    title: tab.title?.trim() || "Current browser tab"
  };
}

function isReadableUrl(url?: string): boolean {
  return Boolean(url && /^(https?|file):\/\//i.test(url));
}

function formatDomain(url?: string): string {
  if (!url) return "Local file";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return "Local file";
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "Current tab";
  }
}

function getDomainInitial(domain: string): string {
  const firstLetter = domain.match(/[a-z0-9]/i)?.[0] ?? "R";
  return firstLetter.toUpperCase();
}
