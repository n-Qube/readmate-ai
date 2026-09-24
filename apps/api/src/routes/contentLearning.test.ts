import { describe, expect, it } from "vitest";
import { __contentInternals } from "./content.js";

const { learningDataForContent } = __contentInternals;

const title = "Bungie shares more detail about Marathon";
const description = "Another big overhaul to the game is now due in March.";
const blocks = [
  { text: "Bungie says the Symbiosis update will rework extraction zones and add 12 new weapons." },
  { text: "The studio also confirmed that Marathon will get a ranked mode in 2027 after player feedback." }
];

describe("import-time study pack", () => {
  const pack = learningDataForContent(title, description, blocks);

  it("does not glue the title onto the first sentence", () => {
    for (const card of pack.flashcards) expect(card.front).not.toMatch(/Marathon Another/);
    for (const point of pack.keyPoints) expect(point.startsWith(title)).toBe(false);
    expect(pack.keyPoints[0]).toBe(description);
  });

  it("makes fill-in-the-blank flashcards whose answer completes the sentence", () => {
    expect(pack.flashcards.length).toBeGreaterThan(0);
    for (const card of pack.flashcards) {
      expect(card.front).toContain("_____");
      const answer = card.back.split(" — ")[0];
      expect(answer.length).toBeGreaterThan(0);
      expect(card.front.replace("_____", answer)).toContain(card.back.split(" — ")[1] ?? "");
    }
  });

  it("prefers numbers and names as the blank", () => {
    const answers = pack.flashcards.map((card) => card.back.split(" — ")[0]);
    expect(answers).toEqual(expect.arrayContaining(["March", "12"]));
  });
});
