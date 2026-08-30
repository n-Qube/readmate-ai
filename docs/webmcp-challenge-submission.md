# ReadMate AI — OpenAI WebMCP Challenge submission

Status: working submission draft for the September 3, 2026 deadline. Replace only the bracketed publication links after the final public repository and video exist.

## Official submission gates

The official deadline is **September 3, 2026 at 1:00 PM Pacific Daylight Time**, which is **8:00 PM in Accra (UTC)**. Target an internal submission cutoff of 6:00 PM Accra time so the final Devpost save and public links are not left to the deadline minute.

The [official rules](https://webmcp.devpost.com/rules) require:

- a working live URL accessible in ChatGPT's in-app browser or WebMCP-enabled Chrome;
- a description explaining why WebMCP fits, how the experience is better, what people and agents can now do together, and how WebMCP was implemented;
- a public GitHub, GitLab, or Bitbucket repository containing the necessary source, assets, functional instructions, and an open-source license that Devpost can detect at the top of the repository;
- clear dated evidence distinguishing the WebMCP work added after August 25 from the pre-existing product—see `CHALLENGE_CHANGELOG.md`;
- a publicly visible YouTube demo under three minutes, with clear functioning product footage and audio explaining the WebMCP implementation;
- free judge access, including private testing credentials when authentication is used, through the end of the judging period;
- English submission material or English translations, and no unlicensed music, third-party copyrighted material, or unauthorized trademark use.

The four equally weighted judging criteria are WebMCP leverage, execution, potential impact, and creativity/ambition. Ghana appears on OpenAI's current [supported-country list](https://developers.openai.com/api/docs/supported-countries), but the entrant must still personally confirm age, identity, and every other eligibility condition. After submission, freeze the Devpost entry, public repository, and live judging build unless the organizers explicitly permit a correction.

## Short project description

ReadMate AI turns a private reading library into a safe, user-controlled browser-agent workspace. Through six WebMCP tools, ChatGPT can search saved reading, confirm a document, prepare it for listening in English or Ghanaian languages, fill a form to save a webpage or RSS feed, and prepare a study pack. Read-only tools can act immediately; writes and quota-consuming AI actions remain visible and require the user to submit a form.

The demo highlights Twi text-to-speech. ChatGPT finds a saved article, confirms its context, and prepares the player for Asante or Akuapem Twi. ReadMate deliberately does not autoplay or consume speech quota—the reader presses Play. The challenge candidate uses the offline Nano-Twi model for Asante Twi because the current Khaya quota will not replenish before the deadline; Akuapem Twi, Ewe, and Ga remain on Khaya.

## What is meaningfully new after August 25, 2026

ReadMate existed before the challenge as a Chrome and mobile reading/listening product. The challenge work adds a new WebMCP interaction layer rather than relabeling an existing feature:

- six typed tool contracts with explicit read, UI-state, write, and paid-AI action classes;
- imperative discovery for private read-only context and visible player preparation;
- declarative, model-readable forms for webpage saving, RSS subscription, and study generation;
- route gating that prevents tool exposure on account, password, billing, deletion, and provider-secret surfaces;
- confirmation, replay, idempotency, untrusted-content, and quota boundaries;
- WebMCP evaluation fixtures for expected calls, clarification, refusal, and tool-result behavior;
- a dedicated authenticated web workspace and public judge landing page;
- local-language listening targets for Twi, Ewe, and Ga, with Twi as the submission demo.

## The six tools

| Tool | Mode | User-facing result | Safety boundary |
| --- | --- | --- | --- |
| `readmate_search_library` | Imperative | Returns matching owned library items | Metadata only; no full document body |
| `readmate_get_document_context` | Imperative | Confirms one owned document and learning availability | Read-only, compact context |
| `readmate_prepare_listening` | Imperative | Opens the player with English, Twi, Ewe, or Ga selected | Never autoplays or consumes speech quota |
| `readmate_add_web_page` | Declarative | Fills a visible webpage-review form | User submits; public HTTPS only |
| `readmate_subscribe_rss` | Declarative | Fills a visible RSS/Atom subscription form | User submits; no removal tool |
| `readmate_generate_study_pack` | Declarative | Fills a visible study-generation form | User submits; clearly quota-consuming |

## Judge walkthrough

1. Open `[LIVE_APP_URL]/challenge` in ChatGPT's in-app browser, which supports WebMCP without an Origin Trial token. Chrome remains an optional flag/origin-trial test path.
2. Select **Launch ReadMate**. The challenge entry skips consumer onboarding; sign in with the supplied judge account and open Library.
3. Ask: “Find my saved article about Ghana.”
4. Ask: “Confirm that document and tell me whether study material is available.”
5. Ask: “Prepare it for listening in Twi.”
6. Confirm that the player opens with Twi selected and no audio starts automatically.
7. Press Play and listen to the Twi speech sample.
8. Ask to save `[LIVE_APP_URL]/challenge`. Confirm that ReadMate fills a visible form and waits for manual submission.
9. Ask to subscribe to `[LIVE_APP_URL]/challenge-feed.xml`. Confirm that the RSS tool fills its visible form and waits for manual submission.
10. Ask to generate a study pack. Confirm that the quota disclosure and manual submission remain visible.

Seed `[LIVE_APP_URL]/challenge-demo` into the judge account for search, context, Twi playback, and study. Use the separate challenge landing for the webpage-save action and the first-party Atom feed for RSS. All three are original ReadMate content, avoid third-party changes, and keep each workflow deterministic without duplicate-source ambiguity.

## Under-three-minute demo plan

Use the exact shots, prompts, stop conditions, recording settings, and YouTube copy in [`docs/webmcp-demo-runbook.md`](./webmcp-demo-runbook.md). The outline below is the compact editorial view.

Target duration: 2 minutes 35 seconds. Record at 1080p with readable browser text and captured system audio.

- **0:00–0:18 — Problem and promise.** Show only ReadMate-owned screens: the challenge landing and library. Narration: “Reading is scattered across tabs, documents, and devices. ReadMate makes that library useful to an assistant without giving the assistant silent control.”
- **0:18–0:38 — Tool discovery.** Open the authenticated ReadMate workspace inside the supported browser. Show the agent-ready status and briefly name the six tools.
- **0:38–1:15 — Read-only workflow.** Ask ChatGPT to find the Ghana article and confirm its context. Keep the library and returned document visible.
- **1:15–1:48 — Twi listening highlight.** Ask ChatGPT to prepare the document in Twi. Point out that nothing autoplays. Press Play, capture 8–12 seconds of clear Twi audio, and show the AI-generated speech disclosure.
- **1:48–2:16 — Human confirmation.** Ask to save the challenge page and briefly show the RSS subscription form. Submit one visible form manually, then show the study-pack form and its quota disclosure without waiting for a full generation.
- **2:16–2:35 — Close.** Show mobile and Chrome surfaces plus the `/challenge` page. Narration: “ReadMate lets an assistant help you search, listen, save, and study—while the reader stays in control.”

Do not spend demo time on App Store, Google Play, Chrome Web Store, billing, or DNS configuration. They are not part of the WebMCP product story.

Use voice narration and captured ReadMate/Twi playback only; do not add background music. Keep unrelated browser tabs, notifications, personal account data, and third-party logos out of frame. Platform UI needed to demonstrate ChatGPT's in-app browser is functional context, not decorative branding.

## Suggested narration

“ReadMate AI is a reading, listening, and study companion built across Chrome and mobile. For the WebMCP Challenge, we added six focused tools that let ChatGPT work with a signed-in reading library. Read-only tools can search and confirm a document immediately. Actions that save content or consume AI quota always stay visible for review.

Here I ask ChatGPT to find my article about Ghana, confirm it, and prepare it for listening in Twi. ReadMate changes the visible player state, but it does not autoplay or spend speech quota. I press Play myself, and the article is translated and synthesized using a Ghanaian Twi voice.

Now I ask to save a webpage. ChatGPT fills the ReadMate form, but I still review and submit it. The same pattern protects RSS subscriptions and study-pack generation. ReadMate makes the assistant genuinely useful while keeping private content scoped and consequential actions under human control.”

## Devpost fields

### Tagline

Your reading library, ready to work with you—in English and Ghanaian languages.

### Inspiration

People save important reading across tabs, PDFs, feeds, and devices, but most of that knowledge becomes passive. ReadMate already helped readers listen and study across Chrome and mobile. WebMCP made it possible to add an assistant that can work with the library directly while preserving the product’s most important boundary: the reader decides when data changes or audio starts.

### What it does

ReadMate exposes six focused tools. ChatGPT can search a signed-in library, confirm document context, prepare local-language listening, fill a form to save a webpage or subscribe to RSS, and prepare a study pack. The demo centers on Twi: the assistant finds an article and prepares it for Asante or Akuapem Twi playback, then the user presses Play.

### How we built it

The authenticated web workspace uses Expo Router and Clerk. Three imperative WebMCP tools handle read-only context and visible player state. Three declarative tools use model-readable HTML forms for writes and paid AI work. A Node/Express API enforces ownership, quotas, idempotency, and replay safety. PostgreSQL stores the synchronized library. Google Translate prepares Twi or Ewe text. Khaya/GhanaNLP TTS v2 handles the hosted Ghanaian-language voices, while a pinned Nano-Twi ONNX model provides the no-subscription Asante Twi challenge fallback. The Chrome extension and mobile apps share the same account library.

### Challenges

The difficult part was not exposing a large API surface. It was making a small tool set safe and predictable: distinguishing read-only actions from writes, preventing autoplay and hidden quota use, keeping untrusted document content out of tool instructions, supporting declarative confirmations, and shipping the exact browser response headers and origin configuration required for discovery.

### Accomplishments

- Six bounded tools cover a complete search-to-listen and save-to-study workflow.
- Write and paid-AI tools remain visibly user-confirmed.
- Twi, Ewe, and Ga are first-class listening targets.
- Deterministic tests cover discovery lifecycle, schemas, confirmations, idempotency, replay safety, and evaluation prompts.
- The same library continues across the web workspace, Chrome extension, and mobile app.

### What we learned

Agentic UX works best when the tool boundary matches the user’s mental model. “Prepare listening” is safer and clearer than “play audio”; a declarative review form is better than a silent write; compact document context is better than exposing full private text. Local-language support also has to be validated as an end-to-end media pipeline, not just a language dropdown.

### What is next

After the challenge, ReadMate can add more African language voices, stronger evaluation coverage, richer citations in study outputs, and user-controlled workflows that connect the Chrome extension and mobile playback queue without broadening access to sensitive pages.

## Final submission checklist

- [ ] `https://app.readmate.n-qube.com` resolves with valid HTTPS.
- [ ] `/challenge` is public and the authenticated workspace loads after launch.
- [ ] Clerk accepts the final origin and production sign-in succeeds.
- [ ] API CORS accepts only the final web origin and approved Chrome extension origin.
- [ ] A supported browser discovers all six tools on approved routes and none on blocked routes.
- [ ] All six workflows pass end to end with the judge account.
- [ ] The judge account contains the stable `/challenge-demo` article and the search prompt returns it unambiguously.
- [ ] Twi translation and TTS produce clear audible output from the live backend.
- [ ] Chrome extension 0.1.5 is reloaded from the packaged source and passes a normal public-article playback test.
- [ ] Public repository contains the source added after August 25, setup/testing instructions, and an owner-approved OSI license.
- [ ] `CHALLENGE_CHANGELOG.md` names the dated public commit range that distinguishes challenge-period work from the pre-existing product.
- [ ] The repository host detects the license and displays it at the top/About section.
- [ ] Public repository and Git history pass the secret hygiene check.
- [ ] Public YouTube video is under three minutes and includes audible Twi playback.
- [ ] The final take satisfies every stop condition in `docs/webmcp-demo-runbook.md`; no local-only success is presented as the submitted live build.
- [ ] Video contains clear spoken audio, no unlicensed music, and no unrelated third-party marks or private notifications.
- [ ] Devpost description links to `[LIVE_APP_URL]`, `https://github.com/n-Qube/readmate-ai`, and `[PUBLIC_VIDEO_URL]`.
- [ ] The live app and judge credentials remain free and available through the end of judging; the submitted build/repository is frozen after the deadline.
- [ ] No unverified App Store, Google Play, or Chrome Web Store approval claim appears in the submission.
