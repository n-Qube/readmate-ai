import { describe, expect, it } from "vitest";
import { __contentInternals } from "./content.js";

const { extractMetadata, attrValue } = __contentInternals;

describe("article metadata extraction", () => {
  it("keeps apostrophes inside double-quoted attributes", () => {
    const html = `<head><meta property="og:title" content="Pixel 11's Call For Me feature begins preliminary rollout"><title>x - Engadget</title></head>`;
    expect(extractMetadata(html, "https://example.com/a").title).toBe("Pixel 11's Call For Me feature begins preliminary rollout");
  });

  it("drops a trailing site-name suffix from the page title", () => {
    const html = `<meta property="og:site_name" content="Engadget"><meta property="og:title" content="Razer's Kiyo V2 Pro webcam can capture 4K video at 60 fps - Engadget">`;
    expect(extractMetadata(html, "https://www.engadget.com/x").title).toBe("Razer's Kiyo V2 Pro webcam can capture 4K video at 60 fps");
    const piped = `<meta property="og:site_name" content="The Verge"><meta property="og:title" content="A headline | The Verge">`;
    expect(extractMetadata(piped, "https://www.theverge.com/x").title).toBe("A headline");
  });

  it("keeps a title that is only the site name", () => {
    const html = `<meta property="og:site_name" content="Engadget"><meta property="og:title" content="Engadget">`;
    expect(extractMetadata(html, "https://www.engadget.com/").title).toBe("Engadget");
  });

  it("prefers the page's own title over a client-supplied site name for saved pages", () => {
    expect(__contentInternals.savedPageTitle("Razer's Kiyo V2 Pro webcam", "Engadget")).toBe("Razer's Kiyo V2 Pro webcam");
    expect(__contentInternals.savedPageTitle("", "My pasted note")).toBe("My pasted note");
    expect(__contentInternals.savedPageTitle("Untitled page", undefined)).toBe("Untitled page");
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
