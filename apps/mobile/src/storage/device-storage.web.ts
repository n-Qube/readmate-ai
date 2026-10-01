// expo-secure-store has no web implementation, so the browser keeps these
// non-secret flags in localStorage. Storage can be blocked (private mode,
// disabled site data); reads then behave like a first visit.
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const deviceStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    storage()?.setItem(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    storage()?.removeItem(key);
  }
};
