export type AuthSession = {
  isSignedIn: boolean;
  userName: string;
  avatarUrl?: string;
  token: string | null;
};

// Older builds persisted a raw session token and profile here. Clerk now owns
// the session, so these keys are only ever removed.
const LEGACY_SESSION_KEYS = ["readmateSessionToken", "readmateUserName", "readmateAvatarUrl"] as const;

/** Signed-out starting state; the Clerk bridge replaces it once it loads. */
export async function getAuthSession(): Promise<AuthSession> {
  await chrome.storage.local.remove([...LEGACY_SESSION_KEYS]);
  return { isSignedIn: false, token: null, userName: "Anonymous reader" };
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove([...LEGACY_SESSION_KEYS]);
}
