export type SyncState = {
  label: string;
  kind: "synced" | "syncing" | "offline" | "auth" | "failed";
};

const syncingActions = new Set([
  "read-page",
  "read-selection",
  "save",
  "upload-pdf",
  "settings",
  "history"
]);

const explicitSyncFailure = /^(?:Document sync failed|Unable to (?:load|save) synced settings|Unable to sync (?:this document|reading progress|flashcard review|quiz result)|Unable to (?:update flashcard review|submit quiz attempt)|Settings saved locally, but synced settings could not be updated|This reading started locally because (?:your ReadMate sign-in session expired|document sync failed))/i;

export function deriveSyncState(
  auth: { isSignedIn?: boolean } | null,
  activeAction: string | null,
  error: string | null,
  isOnline = typeof navigator === "undefined" || navigator.onLine !== false
): SyncState {
  if (!auth?.isSignedIn) return { label: "Sign in required", kind: "auth" };
  if (!isOnline) return { label: "Offline", kind: "offline" };
  if (activeAction && syncingActions.has(activeAction)) return { label: "Syncing...", kind: "syncing" };
  if (error && explicitSyncFailure.test(error)) return { label: "Sync failed", kind: "failed" };
  return { label: "Synced", kind: "synced" };
}
