import { describe, expect, it } from "vitest";
import { isLikelyPdfUrl, pdfSourceUrlFromTab } from "./pdfTab";

describe("PDF tab detection", () => {
  it("recognizes PDF URLs with viewer fragments and query strings", () => {
    expect(isLikelyPdfUrl("https://example.com/report.pdf#page=49")).toBe(true);
    expect(isLikelyPdfUrl("https://example.com/article.html")).toBe(false);
  });

  it("uses the original HTTP tab URL instead of Chrome's internal viewer", () => {
    expect(
      pdfSourceUrlFromTab({
        id: 7,
        title: "Conference-proceedings-eMIG-2023.pdf",
        url: "https://e-mig.ukzn.ac.za/proceedings.pdf#page=49"
      } as chrome.tabs.Tab)
    ).toBe("https://e-mig.ukzn.ac.za/proceedings.pdf#page=49");
    expect(pdfSourceUrlFromTab({
      id: 8,
      title: "dummy.pdf",
      url: "chrome-extension://efaidnbmnnnibpcajpcglclefindmkaj/https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    } as chrome.tabs.Tab)).toBe("https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf");
    expect(pdfSourceUrlFromTab({
      id: 9,
      title: "report.pdf",
      url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=https%3A%2F%2Fexample.com%2Freport.pdf%23page%3D3"
    } as chrome.tabs.Tab)).toBe("https://example.com/report.pdf#page=3");
    expect(pdfSourceUrlFromTab({ id: 10, title: "PDF viewer", url: "chrome-extension://viewer/index.html" } as chrome.tabs.Tab)).toBeUndefined();
  });
});
