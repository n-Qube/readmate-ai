import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReadingDocument } from "@/types";

vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const component = (tag: string) => ({ children, accessibilityLabel }: {
    children?: import("react").ReactNode;
    accessibilityLabel?: string;
  }) => createElement(tag, { "aria-label": accessibilityLabel }, children);
  return { View: component("div"), Text: component("span"), Pressable: component("button"), Platform: { OS: "ios" }, Alert: { alert: vi.fn() } };
});
vi.mock("expo-haptics", () => ({}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/app-icon", () => ({ AppIcon: () => null }));
vi.mock("@/components/editorial-image", () => ({ EditorialImage: () => null }));
vi.mock("@/components/content-card", () => ({ estimateListeningSeconds: () => 60 }));
vi.mock("@/components/mobile-design", () => ({ colors: {}, radius: {}, displayText: {} }));
vi.mock("@/utils/document-blocks", () => import("../utils/document-blocks"));
vi.mock("@/playback/ai-audio-disclosure", () => import("../playback/ai-audio-disclosure"));
vi.mock("@/webmcp/player-deep-link", () => ({ voiceForPlayerLanguage: vi.fn() }));
vi.mock("@/playback/playback-manager", () => ({
  usePlaybackManager: () => ({ state: "ready", percent: 0, duration: 0, currentTime: 0, outputState: { connected: false } })
}));
vi.mock("@/utils/screenshot-mode", () => ({ screenshotMode: false }));

import { PlaybackBar } from "./playback-bar";

const document: ReadingDocument = {
  id: "reading-test",
  userId: "test-user",
  title: "Test reading",
  sourceType: "webpage",
  category: "Test",
  status: "unread",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  provider: "google",
  voice: "en-US-Neural2-F",
  speed: 1,
  blocks: [{ id: "block-1", orderIndex: 0, text: "A short test reading.", blockType: "paragraph" }],
  progress: { percent: 0, blockIndex: 0, characterOffset: 0, sentenceIndex: 0 }
};

describe("playback accessibility", () => {
  it.each(["featured", "compact", "expanded"] as const)(
    "retains narration disclosure for the %s player without adding visible notice text",
    (variant) => {
      const html = renderToStaticMarkup(createElement(PlaybackBar, { document, variant }));
      expect(html).toContain('aria-label="Open full player. AI-generated speech. Synthetic voice—not the original human narration."');
      const visibleText = html.replace(/<[^>]*>/g, "");
      expect(visibleText).not.toContain("AI-generated speech");
      expect(visibleText).toContain("Test reading");
    }
  );

  it.each(["featured", "compact", "expanded"] as const)(
    "does not announce narration for the empty %s player",
    (variant) => {
      const html = renderToStaticMarkup(createElement(PlaybackBar, { variant }));
      expect(html).toContain('aria-label="Open full player"');
      expect(html).not.toContain("AI-generated speech");
    }
  );
});
