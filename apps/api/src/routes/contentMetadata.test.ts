import { describe, expect, it } from "vitest";
import { __contentInternals } from "./content.js";

const { extractMetadata, attrValue } = __contentInternals;

describe("article metadata extraction", () => {
  it("keeps apostrophes inside double-quoted attributes", () => {
    const html = `<head><meta property="og:title" content="Pixel 11's Call For Me feature begins preliminary rollout"><title>x - Engadget</title></head>`;
    expect(extractMetadata(html, "https://example.com/a").title).toBe("Pixel 11's Call For Me feature begins preliminary rollout");
  });

  it("keeps double quotes inside single-quoted attributes", () => {
    expect(attrValue(`<meta content='The "Marathon" update'>`, "content")).toBe(`The "Marathon" update`);
  });

  it("reads og:image and canonical URLs with apostrophes in other attributes", () => {
    const html = `<meta name="twitter:title" content="Copper's latest stove"><meta property="og:image" content="https://img.example.com/c.jpg"><link rel="canonical" href="https://example.com/copper">`;
    const metadata = extractMetadata(html, "https://example.com/x");
    expect(metadata.title).toBe("Copper's latest stove");
    expect(metadata.thumbnailUrl).toBe("https://img.example.com/c.jpg");
  });
});
