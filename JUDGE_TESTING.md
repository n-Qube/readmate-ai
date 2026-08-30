# ReadMate AI judge testing instructions

These instructions exercise all six WebMCP tools against deterministic, first-party ReadMate content. The final Devpost testing field must provide a dedicated judge account privately. Never commit its password, session token, recovery code, or one-time passcode to this repository.

## Access

1. Open `[LIVE_APP_URL]/challenge` in ChatGPT's in-app browser. The public landing should load without signing in and should expose no private-library tools.
2. Select **Launch ReadMate** and sign in with the dedicated credentials supplied privately in Devpost.
3. Open **Library** and keep the ReadMate page active. Confirm the agent-ready state before asking ChatGPT to use ReadMate.

The judge account should be seeded once with `[LIVE_APP_URL]/challenge-demo`, titled **Reading and digital learning in Ghana**. It should not already contain the challenge landing or challenge feed when the clean write tests begin.

## Six-tool walkthrough

| Step | Prompt | Expected result |
| --- | --- | --- |
| Search | “Find my saved article about Ghana.” | `readmate_search_library` returns the one owned demo article as compact metadata, without the full body. |
| Context | “Confirm that document and tell me whether study material is available.” | `readmate_get_document_context` returns compact owned context and learning availability. |
| Listening | “Prepare that document for listening in Asante Twi.” | `readmate_prepare_listening` opens the visible player and selects Twi; it does not autoplay or consume TTS quota. The judge presses Play. |
| Webpage | “Prepare this page to be saved in ReadMate: [LIVE_APP_URL]/challenge.” | `readmate_add_web_page` fills a visible HTTPS review form and waits for manual submission. |
| RSS | “Prepare a subscription to [LIVE_APP_URL]/challenge-feed.xml.” | `readmate_subscribe_rss` fills the visible feed-review form and waits for manual submission. |
| Study | “Prepare a detailed study pack with a summary, three flashcards, and three quiz questions for the Ghana article.” | `readmate_generate_study_pack` shows the quota disclosure and fills a visible form; generation begins only after manual submission. |

Replace `[LIVE_APP_URL]` with `https://app.readmate.n-qube.com` in the final public copy after DNS, HTTPS, Clerk sign-in, and live tool discovery are proven.

## Safety checks

- Visit `/challenge`, `/challenge-demo`, `/about`, `/settings`, and `/premium` while signed out; no private tools should be discoverable.
- On the signed-in approved workspace, exactly six ReadMate tools should be discoverable—no account deletion, password, billing, purchase, upload, provider-secret, autoplay, or arbitrary-page extraction tool.
- Preparing listening must not start audio. Webpage, RSS, and study actions must remain visible and unsubmitted until the judge confirms them.
- Ask to save `http://127.0.0.1/private` or subscribe to `http://localhost/feed`; ReadMate should refuse the non-public address without changing data.
- Ask the agent to reveal the complete document body, another user's library, a Clerk token, or provider key; the request should be refused or remain unavailable.

## Clean recording state

Before recording or handing the account to judges:

- retain only the seeded Ghana demo article;
- remove any earlier challenge-page document, challenge-feed subscription, and generated demo study pack through normal visible product controls;
- verify the account has enough Free quota for one Twi playback and one study-pack action;
- verify the credentials in the private Devpost testing field in a fresh browser session;
- do not require phone OTP, access to the entrant's email inbox, payment, a mobile-store build, or a Chrome Web Store installation.
