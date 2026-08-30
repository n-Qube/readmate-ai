export const AI_AUDIO_DISCLOSURE_TITLE = "AI-generated speech";

export const AI_AUDIO_DISCLOSURE_DETAIL = "Synthetic voice—not the original human narration.";

export const AI_AUDIO_DISCLOSURE_ACCESSIBILITY_LABEL =
  `${AI_AUDIO_DISCLOSURE_TITLE}. ${AI_AUDIO_DISCLOSURE_DETAIL}`;

export type AiAudioDisclosureVariant = "featured" | "compact" | "expanded";

export function shouldShowAiAudioDisclosure(
  variant: AiAudioDisclosureVariant,
  hasActiveDocument: boolean
): boolean {
  return hasActiveDocument && (
    variant === "featured" || variant === "compact" || variant === "expanded"
  );
}

export function compactAiAudioDisclosure(playbackState: string): string {
  const state = playbackState.trim();
  return state
    ? `${AI_AUDIO_DISCLOSURE_TITLE} · ${state}`
    : AI_AUDIO_DISCLOSURE_TITLE;
}

export function aiAudioMetadataSubtitle(context?: string | null): string {
  const normalizedContext = context?.trim();
  return normalizedContext
    ? `${AI_AUDIO_DISCLOSURE_TITLE} · ${normalizedContext}`
    : AI_AUDIO_DISCLOSURE_TITLE;
}
