import { describe, expect, it } from "vitest";
import type { ReadingDocument } from "../shared/types";
import { resolveLearningTarget } from "./studyTarget";

const history = [
  { id: "doc_a", title: "Document A" },
  { id: "doc_b", title: "Document B" }
] as ReadingDocument[];

describe("resolveLearningTarget", () => {
  it("keeps generated Study data bound to its panel document", () => {
    expect(resolveLearningTarget(history, "doc_a", "doc_b")?.id).toBe("doc_b");
  });

  it("uses the active player document before falling back to the latest item", () => {
    expect(resolveLearningTarget(history, "doc_b")?.id).toBe("doc_b");
    expect(resolveLearningTarget(history)?.id).toBe("doc_a");
  });
});
