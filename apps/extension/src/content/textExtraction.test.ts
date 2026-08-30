import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtractionLimitError, extractReadableChunks, extractSelectedTextChunk } from "./textExtraction";

describe("extractReadableChunks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("prefers semantic article content and ignores navigation controls", () => {
    document.body.innerHTML = `
      <header><p>Repeated site chrome</p><button>Subscribe</button></header>
      <article>
        <h1>Practical reading workflows</h1>
        <p>First paragraph with enough useful text for reading aloud. Second sentence keeps the reading moving.</p>
        <nav>Skip this menu</nav>
        <p style="display:none">Hidden tracking copy should not be included.</p>
        <ul><li>Capture the main idea from each article section.</li></ul>
      </article>
      <footer><p>Repeated site chrome</p></footer>
    `;

    const chunks = extractReadableChunks(document, "https://example.com/post", "Article Title");

    expect(chunks).toHaveLength(1);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      [
        "Practical reading workflows",
        "First paragraph with enough useful text for reading aloud. Second sentence keeps the reading moving.",
        "Capture the main idea from each article section."
      ].join("\n\n")
    ]);
    expect(chunks.every((chunk) => chunk.sourceType === "webpage")).toBe(true);
    expect(chunks[0]?.elementSelector).toContain("article");
    expect(chunks[0]?.elementSelectors).toHaveLength(3);
  });

  it("uses the richest readable page region when the first article only contains a headline", () => {
    document.body.innerHTML = `
      <header><p>Repeated site chrome</p></header>
      <article>
        <h1>Everything Google announced at I/O 2026: Gemini, Search, Android XR, & more</h1>
      </article>
      <main>
        <section>
          <p>At I/O 2026, Google announced a wave of new Gemini-powered features across its biggest products and services.</p>
          <p>The article body contains the actual details that should be read aloud and synced to the user library.</p>
        </section>
      </main>
      <footer><p>Repeated site chrome</p></footer>
    `;

    const chunks = extractReadableChunks(document, "https://9to5google.com/post", "Google I/O news");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("At I/O 2026, Google announced");
    expect(chunks[0]?.text).toContain("actual details that should be read aloud");
    expect(chunks[0]?.text).not.toBe("Everything Google announced at I/O 2026: Gemini, Search, Android XR, & more");
  });

  it("prefers the active X thread post over sidebars and promoted content", () => {
    document.body.innerHTML = `
      <main>
        <aside data-testid="sidebarColumn">
          <p>Trending now</p>
          <p>Promoted account that should not be read aloud.</p>
        </aside>
        <article data-testid="tweet">
          <div data-testid="User-Name">BBC News</div>
          <div data-testid="tweetText">
            The first post in this thread explains the breaking story clearly with the details the listener expects.
          </div>
          <div data-testid="placementTracking">
            <p>Promoted</p>
          </div>
        </article>
      </main>
    `;

    const chunks = extractReadableChunks(document, "https://x.com/bbc/status/123", "BBC thread");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("breaking story clearly");
    expect(chunks[0]?.text).not.toContain("Trending now");
    expect(chunks[0]?.text).not.toContain("Promoted account");
    expect(chunks[0]?.elementSelector).toContain("tweetText");
  });

  it("prefers LinkedIn post body text over right rail recommendations", () => {
    document.body.innerHTML = `
      <main>
        <section data-test-id="right-rail">
          <p>People also viewed</p>
          <p>Sponsored company update that is not part of the post.</p>
        </section>
        <div data-urn="urn:li:activity:123">
          <div class="update-components-text">
            This LinkedIn post shares the actual lesson from the author and should be the content ReadMate extracts.
          </div>
        </div>
      </main>
    `;

    const chunks = extractReadableChunks(document, "https://www.linkedin.com/posts/example", "LinkedIn post");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("actual lesson from the author");
    expect(chunks[0]?.text).not.toContain("People also viewed");
    expect(chunks[0]?.text).not.toContain("Sponsored company update");
    expect(chunks[0]?.elementSelector).toContain("update-components-text");
  });

  it("reads the active Facebook post without pulling in feed navigation", () => {
    document.body.innerHTML = `
      <div role="navigation"><div dir="auto">Home Groups Marketplace</div></div>
      <div role="main">
        <div role="article">
          <div data-ad-preview="message">This Facebook post contains the rendered message ReadMate should read aloud.</div>
        </div>
      </div>
    `;

    const chunks = extractReadableChunks(document, "https://www.facebook.com/example/posts/123", "Facebook post");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("rendered message ReadMate should read aloud");
    expect(chunks[0]?.text).not.toContain("Marketplace");
  });

  it("reads a rendered Gmail message body instead of mailbox controls", () => {
    document.body.innerHTML = `
      <div role="navigation"><p>Inbox Sent Drafts</p></div>
      <div role="main">
        <div class="a3s aiL">This email body contains a complete paragraph that ReadMate can safely read aloud.</div>
      </div>
    `;

    const chunks = extractReadableChunks(document, "https://mail.google.com/mail/u/0/#inbox/message", "Email message");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("This email body contains");
    expect(chunks[0]?.text).not.toContain("Inbox Sent Drafts");
  });

  it("reads Google Scholar citation metadata and abstract text", () => {
    document.body.innerHTML = `
      <div role="main" id="gsc_oci_table">
        <div class="gsc_oci_field">Title</div>
        <div class="gsc_oci_value"><a class="gsc_oci_title_link">Useful research on local-language speech</a></div>
        <div class="gsc_oci_field">Description</div>
        <div class="gsc_oci_value" id="gsc_oci_descr">This abstract explains the research findings in enough detail for listening and study.</div>
      </div>
    `;

    const chunks = extractReadableChunks(document, "https://scholar.google.com/citations?view_op=view_citation", "View article");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("Useful research on local-language speech");
    expect(chunks[0]?.text).toContain("This abstract explains the research findings");
  });

  it("rejects hostile pages that exceed the bounded extraction budget", () => {
    document.body.innerHTML = `<main><p>Readable content that would normally be extracted from this page.</p></main>`;
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValue(2_000);

    expect(() => extractReadableChunks(document, "https://example.com/huge", "Huge page")).toThrow(ExtractionLimitError);
  });
});

describe("extractSelectedTextChunk", () => {
  it("returns a single selection chunk with normalized whitespace", () => {
    const chunk = extractSelectedTextChunk(
      "  Selected\n\ncopy from the page.  ",
      "https://example.com",
      "Example"
    );

    expect(chunk).toMatchObject({
      id: "selection-0",
      text: "Selected copy from the page.",
      sourceType: "selection",
      pageUrl: "https://example.com",
      title: "Example"
    });
  });
});
