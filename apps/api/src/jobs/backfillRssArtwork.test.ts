import { describe, expect, it, vi } from "vitest";

vi.mock("../prisma.js", () => ({ prisma: {} }));

import { repairedTitle } from "./backfillRssArtwork.js";

describe("repairedTitle", () => {
  it("restores a title cut at the first apostrophe", () => {
    expect(repairedTitle("Copper", "Copper's latest high-end induction stove brings the heat")).toBe("Copper's latest high-end induction stove brings the heat");
  });

  it("never replaces a title that is not a cut-off prefix", () => {
    expect(repairedTitle("My own name for this", "Copper's latest high-end induction stove")).toBeUndefined();
    expect(repairedTitle("Copper's latest high-end induction stove", "Copper")).toBeUndefined();
    expect(repairedTitle("Copper", undefined)).toBeUndefined();
  });
});
