export type AuthSession = {
  isSignedIn: boolean;
  userName: string;
  avatarUrl?: string;
  token: string | null;
};

export async function getAuthSession(): Promise<AuthSession> {
  const stored = await chrome.storage.local.get(["readmateSessionToken", "readmateUserName", "readmateAvatarUrl"]);
  const token = typeof stored.readmateSessionToken === "string" ? stored.readmateSessionToken : null;
  return {
    isSignedIn: Boolean(token),
    token,
    userName: stored.readmateUserName ?? "Anonymous reader",
    avatarUrl: stored.readmateAvatarUrl
  };
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove(["readmateSessionToken", "readmateUserName", "readmateAvatarUrl"]);
}
