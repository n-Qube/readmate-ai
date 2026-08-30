import { PENDING_READ_REQUEST_KEY, parsePendingReadRequest, sendToActiveTab, sendToTab, type ReadmateMessage } from "./shared/messages";
import { AUTH_SYNC_CHANGED_AT_KEY, cleanupAuthCompletionWindows, closeAuthCompletionWindow, isAuthCompletionTab } from "./shared/authPopup";
import { getClerkFrontendOrigin } from "./sidepanel/clerkUrls";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const clerkSyncHost = (import.meta.env.VITE_CLERK_SYNC_HOST as string | undefined) || getClerkFrontendOrigin(publishableKey);
const clerkSyncHostname = new URL(clerkSyncHost).hostname;
const clerkSessionCookieNames = new Set(["__client", "__client_uat"]);

void cleanupAuthCompletionWindows();

chrome.runtime.onInstalled.addListener(() => {
  resetContextMenus();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

function resetContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: "readmate-read-selection",
        title: "Read with ReadMate",
        contexts: ["selection"]
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn("ReadMate context menu registration skipped:", chrome.runtime.lastError.message);
        }
      }
    );
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "readmate-read-selection" || !tab?.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  await sendToTab(tab.id, {
    type: "READ_FROM_SELECTION",
    text: info.selectionText ?? ""
  } satisfies ReadmateMessage);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "read-selection") return;
  const tab = await getReadableActiveTab();
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  await sendToActiveTab({ type: "READ_SELECTION_OR_PAGE" } satisfies ReadmateMessage);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id) return;
  const pendingRead = parsePendingReadRequest(message);
  if (!pendingRead) return;
  void chrome.storage.local.set({
    [PENDING_READ_REQUEST_KEY]: { ...pendingRead, sourceTabId: sender.tab.id }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isAuthCompletionTab({ ...tab, url: changeInfo.url ?? tab.url })) return;

  void closeAuthCompletionWindow(tab.windowId);
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  const cookieDomain = changeInfo.cookie.domain.replace(/^\./, "");
  if (cookieDomain !== clerkSyncHostname || !clerkSessionCookieNames.has(changeInfo.cookie.name)) return;

  // Never copy the session cookie. This timestamp only wakes the open side panel
  // so Clerk can read the session through its own sync-host integration.
  void chrome.storage.local.set({ [AUTH_SYNC_CHANGED_AT_KEY]: Date.now() });
});

async function getReadableActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const queries: chrome.tabs.QueryInfo[] = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { active: true }
  ];
  const seenTabIds = new Set<number>();
  for (const queryInfo of queries) {
    const matches = await chrome.tabs.query(queryInfo).catch(() => []);
    for (const tab of matches) {
      if (!tab.id || seenTabIds.has(tab.id)) continue;
      seenTabIds.add(tab.id);
      if (/^(https?|file):\/\//i.test(tab.url ?? "")) return tab;
    }
  }
}
