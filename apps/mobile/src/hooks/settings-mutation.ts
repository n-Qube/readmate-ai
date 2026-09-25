import type { QueryClient, UseMutationOptions } from "@tanstack/react-query";
import type { UserSettings } from "../types";

export type EditableSettings = Omit<UserSettings, "userId" | "updatedAt">;

type Context = { previous?: UserSettings };

export const SETTINGS_MUTATION_KEY = ["settings", "save"] as const;

/**
 * Settings saves are optimistic. When several are in flight (for example two
 * quick voice changes), only the newest may write its server reply or roll
 * back; otherwise an older reply lands last and playback flips between voices.
 */
export function settingsMutationOptions(
  queryClient: QueryClient,
  save: (next: EditableSettings) => Promise<UserSettings>
): UseMutationOptions<UserSettings, unknown, EditableSettings, Context> {
  const isLatestSave = () => queryClient.isMutating({ mutationKey: SETTINGS_MUTATION_KEY }) === 1;
  return {
    mutationKey: SETTINGS_MUTATION_KEY,
    mutationFn: save,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous = queryClient.getQueryData<UserSettings>(["settings"]);
      queryClient.setQueryData<UserSettings>(["settings"], (current) => ({
        userId: current?.userId ?? "pending",
        updatedAt: current?.updatedAt ?? new Date().toISOString(),
        ...next
      }));
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous && isLatestSave()) queryClient.setQueryData(["settings"], context.previous);
    },
    onSuccess: (next) => {
      if (isLatestSave()) queryClient.setQueryData(["settings"], next);
    },
    onSettled: () => {
      if (isLatestSave()) return queryClient.invalidateQueries({ queryKey: ["settings"] });
    }
  };
}
