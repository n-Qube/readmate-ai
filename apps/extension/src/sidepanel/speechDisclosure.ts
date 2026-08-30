export type SpeechSource = "cloud" | "browser";

export function syntheticSpeechDisclosure(source: SpeechSource, providerLabel: string): string {
  if (source === "browser") {
    return "Synthetic browser voice. Chrome is generating this narration on this device; it is not a human recording.";
  }

  const provider = providerLabel.trim() || "ReadMate text-to-speech";
  return `AI-generated voice. ReadMate creates this narration with ${provider}; it is not a human recording.`;
}
