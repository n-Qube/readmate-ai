import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "@/types";
import { prependDocument } from "./document-list";

function documentFixture(id: string, title: string): ReadingDocument {
  return {
    id,
    userId: "user-1",
    title,
    sourceType: "document",
    category: "Documents",
    status: "unread",
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
    provider: "google",
    voice: "en-US-Neural2-F",
    speed: 1,
    blocks: []
  };
}

describe("prependDocument", () => {
  it("makes a newly uploaded document visible immediately", () => {
    const oldDocument = documentFixture("old", "Old document");
    const uploaded = documentFixture("uploaded", "Company Profile");

    expect(prependDocument([oldDocument], uploaded)).toEqual([uploaded, oldDocument]);
  });

  it("replaces an existing cached copy instead of duplicating it", () => {
    const oldCopy = documentFixture("uploaded", "Encoded%20title");
    const uploaded = documentFixture("uploaded", "Company Profile");

    expect(prependDocument([oldCopy], uploaded)).toEqual([uploaded]);
  });
});
