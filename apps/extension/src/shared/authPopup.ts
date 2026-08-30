export const AUTH_POPUP_WINDOW_ID_KEY = "readmateAuthPopupWindowId";
export const AUTH_POPUP_CLOSED_AT_KEY = "readmateAuthPopupClosedAt";
export const AUTH_SYNC_CHANGED_AT_KEY = "readmateAuthSyncChangedAt";
export const CLERK_COMPLETION_PLACEHOLDER_URL = "chrome-extension://invalid/";
export const CHROME_ERROR_URL = "chrome-error://chromewebdata/";

type TabLike = Pick<chrome.tabs.Tab, "pendingUrl" | "url" | "title">;

export function isAuthCompletionUrl(url: string | undefined | null): boolean {
  return Boolean(url?.startsWith(CLERK_COMPLETION_PLACEHOLDER_URL));
}

export function isAuthCompletionTab(tab: TabLike | undefined): boolean {
  if (!tab) return false;
  if (isAuthCompletionUrl(tab.pendingUrl) || isAuthCompletionUrl(tab.url)) return true;
  return Boolean(tab.url?.startsWith(CHROME_ERROR_URL) && tab.title?.includes(CLERK_COMPLETION_PLACEHOLDER_URL));
}

export function isHostedAccountCompletionTab(tab: TabLike | undefined, accountPortalOrigin: string): boolean {
  if (!tab) return false;
  return [tab.pendingUrl, tab.url].some((candidate) => {
    if (!candidate) return false;
    try {
      const url = new URL(candidate);
      return url.origin === accountPortalOrigin && url.pathname === "/user";
    } catch {
      return false;
    }
  });
}

export async function closeAuthCompletionWindow(windowId: number): Promise<boolean> {
  const stored = await chrome.storage.local.get(AUTH_POPUP_WINDOW_ID_KEY);
  const authWindow = await chrome.windows.get(windowId, { populate: true }).catch(() => undefined);
  if (!authWindow?.tabs?.some(isAuthCompletionTab)) return false;

  const trackedWindowId = stored[AUTH_POPUP_WINDOW_ID_KEY];
  const isTrackedPopup = trackedWindowId === windowId;
  const isReadMatePopup = authWindow.type === "popup";
  if (!isTrackedPopup && !isReadMatePopup) return false;

  if (isTrackedPopup) {
    await chrome.storage.local.remove(AUTH_POPUP_WINDOW_ID_KEY);
  }
  await chrome.storage.local.set({ [AUTH_POPUP_CLOSED_AT_KEY]: Date.now() });
  await chrome.windows.remove(windowId).catch(() => undefined);
  return true;
}

export async function cleanupAuthCompletionWindows(): Promise<number> {
  const windows = await chrome.windows.getAll({ populate: true }).catch(() => []);
  const results = await Promise.all(
    windows
      .filter((candidate) => typeof candidate.id === "number")
      .map((candidate) => closeAuthCompletionWindow(candidate.id as number))
  );
  return results.filter(Boolean).length;
}
