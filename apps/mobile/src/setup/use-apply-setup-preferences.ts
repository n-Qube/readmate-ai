import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getUserSettings, updateUserSettings } from "@/api/documents";
import { applySetupPreferences, clearSetupPreferences, loadSetupPreferences } from "@/setup/setup-preferences";

/**
 * Applies the voice, speed, and content choices made during first-run setup
 * to the signed-in account once. On failure the choices stay parked and are
 * retried on the next launch.
 */
export function useApplySetupPreferences(enabled: boolean) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const preferences = await loadSetupPreferences();
      if (!preferences || cancelled) return;
      const token = await getToken();
      const { userId: _userId, updatedAt: _updatedAt, ...current } = await getUserSettings(token);
      if (cancelled) return;
      const saved = await updateUserSettings(token, applySetupPreferences(current, preferences));
      queryClient.setQueryData(["settings"], saved);
      await clearSetupPreferences();
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, getToken, queryClient]);
}
