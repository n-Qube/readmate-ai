import { clearHighlights, highlightChunk } from "./content/highlighter";
import { hideFloatingPlayer, showFloatingPlayer } from "./content/floatingPlayer";
import { ExtractionLimitError, extractReadableChunks, extractSelectedTextChunks } from "./content/textExtraction";
import type { ReadmateMessage } from "./shared/messages";

type ReadmateContentWindow = Window & {
  __readmateContentListenerInstalled?: boolean;
};

const readmateWindow = window as ReadmateContentWindow;

if (!readmateWindow.__readmateContentListenerInstalled) {
  chrome.runtime.onMessage.addListener(handleReadmateMessage);
  readmateWindow.__readmateContentListenerInstalled = true;
}

function handleReadmateMessage(message: ReadmateMessage) {
  if (message.type === "READ_CURRENT_PAGE") {
    extractAndSend(() => extractReadableChunks());
  }
  if (message.type === "READ_SELECTION") {
    extractAndSend(() => extractSelectedTextChunks(window.getSelection()));
  }
  if (message.type === "READ_SELECTION_OR_PAGE") {
    extractAndSend(() => {
      const selectedChunks = extractSelectedTextChunks(window.getSelection());
      return selectedChunks.length ? selectedChunks : extractReadableChunks();
    });
  }
  if (message.type === "READ_FROM_SELECTION") {
    extractAndSend(() => extractSelectedTextChunks(message.text));
  }
  if (message.type === "HIGHLIGHT_CHUNK") highlightChunk(message.selector, message.settings, message.text, message.selectors);
  if (message.type === "CLEAR_HIGHLIGHTS") clearHighlights();
  if (message.type === "SHOW_FLOATING_PLAYER") {
    message.visible ? showFloatingPlayer() : hideFloatingPlayer();
  }
}

function extractAndSend(extract: () => ReturnType<typeof extractReadableChunks>): void {
  try {
    sendReadChunks(extract());
  } catch (error) {
    const message = error instanceof ExtractionLimitError
      ? error.message
      : "ReadMate could not safely extract this page.";
    sendRuntimeMessage({
      type: "READ_EXTRACTION_ERROR",
      error: message,
      requestId: createReadRequestId(),
      createdAt: Date.now()
    });
  }
}

function sendReadChunks(chunks: ReturnType<typeof extractReadableChunks>): void {
  sendRuntimeMessage({
    type: "READ_CHUNKS",
    chunks,
    requestId: createReadRequestId(),
    createdAt: Date.now()
  });
}

function sendRuntimeMessage(message: ReadmateMessage): void {
  chrome.runtime.sendMessage(message).catch((error) => {
    if (!isNoReceiverError(error)) console.warn("ReadMate could not deliver content message.", error);
  });
}

function createReadRequestId(): string {
  return crypto.randomUUID?.() ?? `readmate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isNoReceiverError(error: unknown): boolean {
  return error instanceof Error && /Receiving end does not exist|Could not establish connection/i.test(error.message);
}
