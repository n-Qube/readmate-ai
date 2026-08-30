import { beforeEach, describe, expect, it, vi } from "vitest";
import { canInjectIntoUrl, parsePendingReadRequest, resolveActiveReadableTab, sendToActiveTab } from "./messages";

type QueryInfo = chrome.tabs.QueryInfo;

const cnnTab = { id: 42, active: true, windowId: 3, url: "https://edition.cnn.com/2026/05/22/china/article" } as chrome.tabs.Tab;
const engadgetTab = { id: 81, active: true, windowId: 4, url: "https://www.engadget.com/example" } as chrome.tabs.Tab;
const unsupportedTab = { id: 7, active: true, windowId: 5, url: "chrome://extensions/" } as chrome.tabs.Tab;

describe("sendToActiveTab", () => {
  const sendMessage = vi.fn();
  const executeScript = vi.fn();
  const get = vi.fn();
  const query = vi.fn();
  const getCurrent = vi.fn();
  const getLastFocused = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    sendMessage.mockResolvedValue(undefined);
    executeScript.mockResolvedValue(undefined);
    get.mockImplementation(async (tabId: number) => (tabId === cnnTab.id ? cnnTab : unsupportedTab));
    getCurrent.mockResolvedValue({ id: 3, type: "normal" });
    getLastFocused.mockResolvedValue({ id: 3, type: "normal" });
    vi.stubGlobal("chrome", {
      tabs: {
        query,
        get,
        sendMessage
      },
      scripting: {
        executeScript
      },
      windows: {
        getCurrent,
        getLastFocused
      }
    });
  });

  it("targets the active tab in the side panel's current normal window", async () => {
    query.mockImplementation(async (queryInfo: QueryInfo) => {
      if (queryInfo.windowId === 3) return [cnnTab];
      return [];
    });

    const result = await sendToActiveTab({ type: "READ_CURRENT_PAGE" });

    expect(result).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledWith(cnnTab.id, { type: "READ_CURRENT_PAGE" });
  });

  it("uses an exact activated tab instead of another window's active tab", async () => {
    get.mockImplementation(async (tabId: number) => (tabId === engadgetTab.id ? engadgetTab : cnnTab));
    query.mockResolvedValue([cnnTab]);

    const tab = await resolveActiveReadableTab({ preferredTabId: engadgetTab.id });

    expect(tab?.id).toBe(engadgetTab.id);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not scan every active Chrome window when the current tab is unsupported", async () => {
    getCurrent.mockResolvedValue({ id: 5, type: "normal" });
    getLastFocused.mockResolvedValue({ id: 5, type: "normal" });
    query.mockImplementation(async (queryInfo: QueryInfo) => queryInfo.windowId === 5 ? [unsupportedTab] : [cnnTab]);

    const result = await sendToActiveTab({ type: "READ_CURRENT_PAGE" });

    expect(result).toMatchObject({ ok: false, reason: "unsupported-tab" });
    expect(query).not.toHaveBeenCalledWith({ active: true });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("reports an unsupported tab when no active readable tab exists", async () => {
    query.mockResolvedValue([unsupportedTab]);

    const result = await sendToActiveTab({ type: "READ_CURRENT_PAGE" });

    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported-tab"
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("parsePendingReadRequest", () => {
  it("retains the source tab id used to reject stale cross-tab responses", () => {
    const createdAt = Date.now();

    expect(parsePendingReadRequest({
      type: "READ_CHUNKS",
      requestId: "request-1",
      createdAt,
      sourceTabId: 81,
      chunks: [{ id: "chunk-1", text: "Readable article text", sourceType: "webpage" }]
    })).toMatchObject({ requestId: "request-1", createdAt, sourceTabId: 81 });
  });
});

describe("canInjectIntoUrl", () => {
  it("allows ordinary web pages and local files", () => {
    expect(canInjectIntoUrl("https://example.com/article")).toBe(true);
    expect(canInjectIntoUrl("file:///Users/example/report.html")).toBe(true);
  });

  it("rejects Chrome internal pages and the Chrome Web Store", () => {
    expect(canInjectIntoUrl("chrome://extensions/")).toBe(false);
    expect(canInjectIntoUrl("https://chromewebstore.google.com/detail/example/id")).toBe(false);
    expect(canInjectIntoUrl("https://chrome.google.com/webstore/detail/example/id")).toBe(false);
  });
});
