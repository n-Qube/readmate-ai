import type { ExtensionSettings, ReadingChunk } from "./types";

export const PENDING_READ_REQUEST_KEY = "readmatePendingReadRequest";

export type PendingReadRequest = {
  requestId: string;
  chunks: ReadingChunk[];
  createdAt: number;
  sourceTabId?: number;
  error?: string;
};

export type ReadmateMessage =
  | { type: "READ_CURRENT_PAGE" }
  | { type: "READ_SELECTION" }
  | { type: "READ_SELECTION_OR_PAGE" }
  | { type: "READ_FROM_SELECTION"; text: string }
  | { type: "READ_CHUNKS"; chunks: ReadingChunk[]; requestId?: string; createdAt?: number }
  | { type: "READ_EXTRACTION_ERROR"; error: string; requestId?: string; createdAt?: number }
  | { type: "HIGHLIGHT_CHUNK"; chunkId: string; selector?: string; selectors?: string[]; text?: string; settings: ExtensionSettings }
  | { type: "CLEAR_HIGHLIGHTS" }
  | { type: "MINI_PLAYER_ACTION"; action: "play" | "pause" | "rewind" | "forward" | "close" }
  | { type: "SHOW_FLOATING_PLAYER"; visible: boolean };

export type TabMessageResult =
  | { ok: true }
  | { ok: false; reason: "no-active-tab" | "no-receiver" | "unsupported-tab" | "failed"; message: string };

const MAX_READ_CHUNKS = 250;
const MAX_READ_CHUNK_CHARS = 7_000;
const MAX_READ_TOTAL_CHARS = 1_000_000;

export function parsePendingReadRequest(message: unknown): PendingReadRequest | null {
  if (!message || typeof message !== "object") return null;
  const value = message as Record<string, unknown>;
  if (value.type !== "READ_CHUNKS" && value.type !== "READ_EXTRACTION_ERROR") return null;
  const requestId = typeof value.requestId === "string" && value.requestId.length <= 160 ? value.requestId : undefined;
  const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : undefined;
  const sourceTabId = typeof value.sourceTabId === "number" && Number.isInteger(value.sourceTabId) && value.sourceTabId > 0
    ? value.sourceTabId
    : undefined;
  if (!requestId || !createdAt || Math.abs(Date.now() - createdAt) > 60_000) return null;

  if (value.type === "READ_EXTRACTION_ERROR") {
    if (typeof value.error !== "string" || value.error.length === 0 || value.error.length > 300) return null;
    return { requestId, createdAt, sourceTabId, chunks: [], error: value.error };
  }
  if (!Array.isArray(value.chunks) || value.chunks.length > MAX_READ_CHUNKS) return null;
  let totalChars = 0;
  for (const chunk of value.chunks) {
    if (!isReadingChunk(chunk)) return null;
    totalChars += chunk.text.length;
    if (totalChars > MAX_READ_TOTAL_CHARS) return null;
  }
  return { requestId, createdAt, sourceTabId, chunks: value.chunks };
}

function isReadingChunk(value: unknown): value is ReadingChunk {
  if (!value || typeof value !== "object") return false;
  const chunk = value as Record<string, unknown>;
  return (
    typeof chunk.id === "string" && chunk.id.length > 0 && chunk.id.length <= 200 &&
    typeof chunk.text === "string" && chunk.text.length > 0 && chunk.text.length <= MAX_READ_CHUNK_CHARS &&
    typeof chunk.sourceType === "string" && ["webpage", "selection", "pdf", "ocr", "url", "rss", "news", "document"].includes(chunk.sourceType) &&
    (!chunk.elementSelectors || (Array.isArray(chunk.elementSelectors) && chunk.elementSelectors.length <= 200 && chunk.elementSelectors.every((item) => typeof item === "string" && item.length <= 1000)))
  );
}

export function isNoReceiverError(error: unknown): boolean {
  return error instanceof Error && /Receiving end does not exist|Could not establish connection/i.test(error.message);
}

export async function sendToTab(tabId: number, message: ReadmateMessage): Promise<TabMessageResult> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return { ok: true };
  } catch (error) {
    if (isNoReceiverError(error)) {
      return injectContentScriptAndRetry(tabId, message);
    }
    return {
      ok: false,
      reason: "failed",
      message: error instanceof Error ? error.message : "ReadMate could not communicate with this tab."
    };
  }
}

async function injectContentScriptAndRetry(tabId: number, message: ReadmateMessage): Promise<TabMessageResult> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const url = tab?.url ?? "";
  if (!canInjectIntoUrl(url)) {
    return {
      ok: false,
      reason: "unsupported-tab",
      message: "ReadMate cannot access this browser page directly. Open a regular web page, or upload the PDF in the side panel."
    };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tabId, message);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "no-receiver",
      message: error instanceof Error ? error.message : "ReadMate could not connect to this page after injecting its reader."
    };
  }
}

export function canInjectIntoUrl(url: string): boolean {
  if (!/^(https?|file):\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname !== "chromewebstore.google.com" && parsed.hostname !== "chrome.google.com";
  } catch {
    return false;
  }
}

export async function sendToActiveTab(message: ReadmateMessage, preferredTabId?: number | null): Promise<TabMessageResult> {
  const readableTab = await resolveActiveReadableTab({ preferredTabId });
  if (readableTab?.id) {
    return sendToTab(readableTab.id, message);
  }
  const activeTab = await resolveActiveTab({ preferredTabId });
  if (!activeTab) {
    return {
      ok: false,
      reason: "no-active-tab",
      message: "ReadMate could not find an active tab to read."
    };
  }
  return {
    ok: false,
    reason: "unsupported-tab",
    message: "Chrome protects this page from extensions. Open a regular website, or use the PDF button in ReadMate."
  };
}

export async function resolveActiveReadableTab(options: {
  preferredTabId?: number | null;
  preferredWindowId?: number;
} = {}): Promise<chrome.tabs.Tab | undefined> {
  const tab = await resolveActiveTab(options);
  return tab?.id && canInjectIntoUrl(tab.url ?? "") ? tab : undefined;
}

export async function resolveActiveTab(options: {
  preferredTabId?: number | null;
  preferredWindowId?: number;
}): Promise<chrome.tabs.Tab | undefined> {
  if (options.preferredTabId) {
    const preferred = await chrome.tabs.get(options.preferredTabId).catch(() => undefined);
    if (preferred?.active) return preferred;
  }

  const checkedWindowIds = new Set<number>();
  const fromWindow = async (windowId: number | undefined) => {
    if (typeof windowId !== "number" || windowId < 0 || checkedWindowIds.has(windowId)) return undefined;
    checkedWindowIds.add(windowId);
    const matches = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
    return matches[0];
  };

  const preferredWindowTab = await fromWindow(options.preferredWindowId);
  if (preferredWindowTab) return preferredWindowTab;

  const currentWindow = await chrome.windows?.getCurrent?.().catch(() => undefined);
  if (currentWindow?.type === "normal") {
    const currentWindowTab = await fromWindow(currentWindow.id);
    if (currentWindowTab) return currentWindowTab;
  }

  const lastFocusedWindow = await chrome.windows?.getLastFocused?.().catch(() => undefined);
  if (lastFocusedWindow?.type === "normal") {
    return fromWindow(lastFocusedWindow.id);
  }

  // Older test/browser shims may not expose chrome.windows. Keep the fallback
  // scoped to a single window and never scan every active tab across Chrome.
  if (!chrome.windows?.getCurrent && !chrome.windows?.getLastFocused) {
    const matches = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    return matches[0];
  }
}
