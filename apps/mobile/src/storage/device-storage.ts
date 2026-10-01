import * as SecureStore from "expo-secure-store";

/** Small, non-secret device flags (onboarding state, parked setup choices). */
export const deviceStorage = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key)
};
