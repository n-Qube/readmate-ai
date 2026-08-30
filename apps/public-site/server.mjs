import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8080);
const iconPath = fileURLToPath(new URL("./icon.png", import.meta.url));

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), tools=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

const styles = `
  :root { color-scheme: light; --paper: #f7f3e9; --surface: #fffdf8; --ink: #192019; --muted: #667066; --wine: #813848; --forest: #173c2c; --line: #ddd7c9; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.65 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  a { color: var(--wine); text-underline-offset: 3px; }
  .shell { width: min(960px, calc(100% - 40px)); margin: 0 auto; }
  header { border-bottom: 1px solid var(--line); background: rgba(255, 253, 248, 0.92); }
  .header-row { min-height: 84px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .brand { display: inline-flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; font-family: Georgia, "Times New Roman", serif; font-size: 28px; font-weight: 700; }
  .brand img { width: 48px; height: 48px; border-radius: 13px; }
  nav { display: flex; gap: 18px; flex-wrap: wrap; }
  nav a { color: var(--muted); font-size: 15px; font-weight: 700; text-decoration: none; }
  nav a:hover, nav a:focus-visible { color: var(--wine); }
  main { padding: 64px 0 80px; }
  .hero { padding: 64px; border: 1px solid var(--line); border-radius: 36px; background: var(--surface); box-shadow: 0 22px 60px rgba(61, 49, 29, 0.08); }
  .eyebrow { margin: 0 0 18px; color: var(--wine); font-size: 14px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
  h1, h2 { font-family: Georgia, "Times New Roman", serif; line-height: 1.08; }
  h1 { max-width: 720px; margin: 0; font-size: clamp(46px, 8vw, 82px); letter-spacing: -0.045em; }
  h2 { margin: 38px 0 12px; font-size: 30px; }
  .lead { max-width: 680px; margin: 28px 0 0; color: var(--muted); font-size: 21px; }
  .actions { display: flex; gap: 12px; margin-top: 34px; flex-wrap: wrap; }
  .button { display: inline-flex; align-items: center; justify-content: center; min-height: 50px; padding: 0 22px; border-radius: 999px; background: var(--forest); color: white; font-weight: 800; text-decoration: none; }
  .button.secondary { border: 1px solid var(--line); background: transparent; color: var(--wine); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 28px; }
  .card { padding: 26px; border: 1px solid var(--line); border-radius: 24px; background: var(--surface); }
  .card h2 { margin-top: 0; font-size: 24px; }
  .card p { margin-bottom: 0; color: var(--muted); }
  .document { max-width: 820px; padding: 46px; border: 1px solid var(--line); border-radius: 28px; background: var(--surface); }
  .document h1 { font-size: clamp(40px, 7vw, 64px); }
  .document p, .document li { color: #3f493f; }
  .updated { color: var(--wine) !important; font-weight: 700; }
  footer { padding: 28px 0 44px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
  .footer-row { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
  @media (max-width: 760px) { .header-row { align-items: flex-start; padding: 18px 0; flex-direction: column; } main { padding-top: 34px; } .hero { padding: 34px 26px; border-radius: 26px; } .grid { grid-template-columns: 1fr; } .document { padding: 30px 24px; } }
`;

function layout({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${description}">
    <title>${title}</title>
    <link rel="icon" href="/icon.png">
    <style>${styles}</style>
  </head>
  <body>
    <header>
      <div class="shell header-row">
        <a class="brand" href="/"><img src="/icon.png" alt="ReadMate AI logo">ReadMate AI</a>
        <nav aria-label="Main navigation"><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
      </div>
    </header>
    <main><div class="shell">${body}</div></main>
    <footer><div class="shell footer-row"><span>© 2026 ReadMate AI</span><span>Contact: <a href="mailto:nii.nortey@gmail.com">nii.nortey@gmail.com</a></span></div></footer>
  </body>
</html>`;
}

const homePage = layout({
  title: "ReadMate AI — Read, listen, and learn",
  description: "ReadMate AI helps you save webpages and documents, listen with text-to-speech, and create study materials.",
  body: `
    <section class="hero">
      <p class="eyebrow">Your reading companion</p>
      <h1>Read it. Hear it. Remember it.</h1>
      <p class="lead">ReadMate AI brings webpages, PDFs, and documents into one focused library—then helps you listen, highlight, translate, and study across mobile and Chrome.</p>
      <div class="actions"><a class="button" href="https://accounts.readmate.n-qube.com/sign-in">Sign in to ReadMate AI</a><a class="button secondary" href="/privacy">How we protect your data</a></div>
    </section>
    <section class="grid" aria-label="ReadMate features">
      <article class="card"><h2>Save anything</h2><p>Add webpages, RSS feeds, PDFs, Word documents, EPUBs, Markdown, RTF, and plain text.</p></article>
      <article class="card"><h2>Listen your way</h2><p>Use text-to-speech and supported local-language playback to keep reading wherever you are.</p></article>
      <article class="card"><h2>Study deeply</h2><p>Create summaries, flashcards, quizzes, notes, and highlights from the content you choose.</p></article>
    </section>
  `
});

const privacyPage = layout({
  title: "Privacy Policy — ReadMate AI",
  description: "ReadMate AI privacy policy and information about account, content, and Google Sign-In data.",
  body: `
    <article class="document">
      <p class="eyebrow">Legal</p>
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated: August 29, 2026</p>
      <p>ReadMate AI helps users save webpages, upload documents, read articles, listen with text-to-speech, and create study materials. This policy explains what information the service handles and why.</p>

      <h2>Information we process</h2>
      <ul><li>Account identifiers needed for sign-in and syncing across devices.</li><li>Saved reading items, uploaded documents, document metadata, playback progress, notes, highlights, sources, and preferences.</li><li>Selected or saved text that you ask ReadMate AI to translate, summarize, study, or convert into audio.</li></ul>

      <h2>Google Sign-In data</h2>
      <p>If you choose Google Sign-In, ReadMate AI receives the basic profile information Google authorizes, such as your name, email address, profile image, and Google account identifier. We use it only to create and secure your account, display your profile, and sync your ReadMate data across supported devices.</p>
      <p>ReadMate AI does not request access to Gmail, Google Drive files, contacts, calendars, or other Google services. We do not sell Google user data or use it for advertising. Authentication information is shared only with service providers required to operate account sign-in and ReadMate AI.</p>

      <h2>How we use information</h2>
      <p>We process information to provide requested app functionality, sync your library, extract readable text, generate study materials, translate supported content, produce text-to-speech audio, secure accounts, prevent abuse, and maintain the service.</p>

      <h2>Browser-agent tools</h2>
      <p>On supported ReadMate web pages, a browser agent may discover and invoke ReadMate tools for the signed-in user on the active page. ReadMate keeps write actions and AI-usage actions visible for user review and confirmation. Saved content or selected text is processed by AI, translation, or text-to-speech providers only when the user requests the corresponding function.</p>
      <p>ReadMate does not use WebMCP tools to export a user’s library to another website, enable cross-site tracking, manage payments, or expose provider credentials. Speech created through these features is AI-generated.</p>

      <h2>Service providers</h2>
      <p>ReadMate AI uses service providers for authentication, database and file storage, hosting, content processing, translation, AI study features, and text-to-speech generation. Content is sent to these providers only when needed to provide a feature you request.</p>

      <h2>What we do not do</h2>
      <p>ReadMate AI does not continuously record your screen, collect passwords, read hidden form fields, capture sensitive pages by default, sell personal data, or use saved reading content for targeted advertising.</p>

      <h2>Retention and deletion</h2>
      <p>Account-linked content is retained so it can sync across your devices. You can delete individual reading items and related content, or delete your ReadMate AI account from Settings. Account deletion removes account-linked app records unless retention is required for legal, security, or abuse-prevention reasons.</p>

      <h2>Security</h2>
      <p>We use access controls, encrypted connections, scoped credentials, and operational safeguards designed to protect your information. No online service can guarantee absolute security.</p>

      <h2>Contact</h2>
      <p>For privacy questions or deletion requests, email <a href="mailto:nii.nortey@gmail.com">nii.nortey@gmail.com</a>.</p>
    </article>
  `
});

const termsPage = layout({
  title: "Terms of Service — ReadMate AI",
  description: "Terms governing use of ReadMate AI.",
  body: `
    <article class="document">
      <p class="eyebrow">Legal</p>
      <h1>Terms of Service</h1>
      <p class="updated">Last updated: August 28, 2026</p>
      <p>These terms govern your use of ReadMate AI. By creating an account or using the service, you agree to them.</p>

      <h2>Using ReadMate AI</h2>
      <p>You may use ReadMate AI to save and upload content, listen with text-to-speech, sync reading progress, and create study materials. You must use the service lawfully and must not interfere with its security, availability, or operation.</p>

      <h2>Your content</h2>
      <p>You retain ownership of content you submit. You grant ReadMate AI a limited permission to process, store, translate, summarize, and convert that content to audio only as needed to provide the features you request. You are responsible for ensuring that you have the right to submit and use the content.</p>

      <h2>AI and text-to-speech</h2>
      <p>AI-generated summaries, study materials, translations, and synthesized speech may contain errors or omissions. Review important information against the original source. ReadMate AI is not a substitute for professional legal, medical, financial, or academic advice.</p>

      <h2>Accounts and acceptable use</h2>
      <p>You are responsible for activity under your account and for keeping access to it secure. We may limit or suspend access when reasonably necessary to prevent abuse, protect users, comply with law, or maintain the service.</p>

      <h2>Availability and changes</h2>
      <p>We work to keep ReadMate AI available, but the service may occasionally be interrupted, changed, or discontinued. Features may depend on third-party authentication, hosting, storage, AI, translation, and text-to-speech providers.</p>

      <h2>Disclaimers and liability</h2>
      <p>ReadMate AI is provided on an “as available” basis to the extent permitted by law. We do not guarantee that generated content will be accurate or that the service will always be uninterrupted. To the extent permitted by law, ReadMate AI is not liable for indirect, incidental, special, or consequential losses arising from use of the service.</p>

      <h2>Ending your use</h2>
      <p>You may stop using ReadMate AI at any time and can delete your account from Settings. Account deletion is handled as described in the <a href="/privacy">Privacy Policy</a>.</p>

      <h2>Changes to these terms</h2>
      <p>We may update these terms as the service changes. The updated date above shows when they were revised. Continued use after an update means you accept the revised terms.</p>

      <h2>Contact</h2>
      <p>Questions about these terms can be sent to <a href="mailto:nii.nortey@gmail.com">nii.nortey@gmail.com</a>.</p>
    </article>
  `
});

const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  const headers = { ...securityHeaders };

  if (pathname === "/health") {
    response.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/icon.png") {
    response.writeHead(200, { ...headers, "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
    createReadStream(iconPath).pipe(response);
    return;
  }

  const pages = { "/": homePage, "/privacy": privacyPage, "/terms": termsPage };
  const page = pages[pathname];
  if (!page) {
    response.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    response.end("Page not found");
    return;
  }

  response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  response.end(page);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ReadMate public site listening on ${port}`);
});
