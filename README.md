# ReadMate AI

ReadMate AI is a cross-device reading, listening, and study companion with a Manifest V3 Chrome extension, Expo mobile/web app, and Node/Express API. The WebMCP Challenge build exposes six bounded browser-agent tools for searching a private library, confirming document context, preparing local-language listening, saving a webpage, subscribing to RSS, and generating study materials.

ReadMate AI is open source under the [MIT License](./LICENSE).

The public judge landing page is exported at `/challenge`. It explains the six tools, the Twi listening demo, the confirmation model, and a one-minute evaluation path without requiring Clerk to initialize.

The same Firebase export publishes an original, stable Ghana reading sample at `/challenge-demo`. It gives the judge account a deterministic source for library search, Twi playback, webpage saving, and study generation without depending on a third-party article that may change.

## OpenAI WebMCP Challenge

The WebMCP integration added after August 25, 2026 is a meaningful new interaction layer for the existing ReadMate product:

- three imperative tools handle private read-only context and visible player state;
- three declarative tools fill reviewable forms for writes or paid AI work;
- route gating keeps tools off account, billing, password, and provider-secret surfaces;
- listening preparation supports English, Twi, Ewe, and Ga but never starts speech or consumes quota until the user presses Play;
- deterministic contracts and evaluation fixtures cover expected calls, clarification, refusal, confirmation, replay safety, and untrusted content.

The competition narrative, judge flow, demo outline, and verification checklist are in `docs/webmcp-challenge-submission.md`.

The deterministic six-tool evaluation path and private-credential handling requirements are in `JUDGE_TESTING.md`.

The source-publication preflight is `npm run check:publication`. The stricter final gate, `npm run check:publication:final`, also requires the approved MIT license and real live-app, repository, and demo-video links. Until those publication links are verified, this working tree should not be represented as the final challenge release.

## What is included

- Chrome extension with `manifest.json`, background service worker, content script, side panel, popup, and injected floating player.
- Authenticated Expo web workspace with six WebMCP tools and a public `/challenge` page.
- DOM text extraction for semantic page content and selected text.
- PDF upload extraction in the side panel with `pdfjs-dist`.
- Paragraph-level highlighting via `.readmate-current-highlight`.
- Playback controls: play, pause, stop, rewind/forward 10 seconds, previous/next chunk, speed, progress, voice, and tone instructions.
- TTS backend endpoint at `POST /api/tts` using Google Cloud Text-to-Speech.
- Clerk-protected backend routes and extension-side Clerk provider support.
- Prisma schema for reading documents and reading sessions.
- Anonymous local history fallback when the user is not signed in.
- Placeholder Phase 2 OCR UI with explicit permission language.

## Project structure

```text
apps/
  api/          Express API, Clerk auth, Google TTS, Prisma history routes
  extension/    Chrome MV3 extension built with React, Vite, and TypeScript
  mobile/       Expo app for synced library, progress, and mobile reading
docs/
  readmate-revamp-prd.md             Product requirements for the cross-device revamp
  mobile-sync-implementation-plan.md Engineering plan for Chrome-to-mobile sync
  release-blockers.md                Remaining platform, store, and production launch tasks
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure the API environment without placing secrets in this repository. Export variables from your shell/secret manager, or point `READMATE_ENV_FILE` at a file outside the repository:

```bash
export READMATE_ENV_FILE=/absolute/path/outside/readmate/api.env
```

Set:

- `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SERVICE_ACCOUNT_JSON`: server-side Google Cloud TTS credentials.
- `CLERK_SECRET_KEY`: backend Clerk verification.
- `DATABASE_URL`: PostgreSQL connection string. For Supabase on IPv4-only networks, use the Session Pooler URI from the dashboard.
- `VITE_CLERK_PUBLISHABLE_KEY`: add this to `apps/extension/.env.local` for Clerk UI in the extension.

3. Generate Prisma client and migrate:

```bash
npm run prisma:generate -w apps/api
npm run prisma:migrate -w apps/api
```

4. Run the backend:

```bash
npm run dev:api
```

5. Build the extension:

```bash
npm run build -w apps/extension
```

6. Install in Chrome:

- Open `chrome://extensions`.
- Enable Developer mode.
- Click “Load unpacked”.
- Select `apps/extension/dist`.

## Mobile app

The mobile workspace is an Expo app that uses the same Clerk user and backend document-sync API as the Chrome extension.

1. Configure mobile public values. These values are bundled into the app and must never contain secrets:

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_READMATE_API_URL`. Production EAS builds read them from the EAS `production` environment; do not add them to `eas.json`.

2. Install the new workspace dependencies if they are not already installed:

```bash
npm install
```

3. Start Expo:

```bash
npm run start -w apps/mobile
```

Run every EAS command from `apps/mobile`. That directory is the sole Expo project and build-configuration source of truth.

## Authenticated web workspace

The Expo Router app exports through a guarded Firebase Hosting adapter for the authenticated WebMCP workspace. This provides a no-subscription deployment path for the challenge while keeping the app, API, and identity origins separate. A production export is local-only and requires a live Clerk publishable key, an HTTPS API origin, and a separate exact `WEB_APP_ORIGIN`:

```bash
npm run validate:public-ui -w apps/mobile
npm run export:web:firebase
```

The export command does not deploy. It verifies the reviewed public-environment allowlist, builds `apps/mobile/dist`, stages `apps/mobile/dist/firebase-hosting`, checks the Firebase header and clean-route contract, and scans generated web files for backend-only configuration. The guarded deploy separately pins the exact Firebase project, site, API origin, artifact digest, and Origin-Trial header. See `docs/firebase-hosting-adapter.md` and `docs/webmcp-deployment.md` for the DNS, Clerk, CORS, HTTPS, and live-verification gates.

### WebMCP browser-agent setup

ReadMate progressively adds six tools when a supported browser exposes `document.modelContext` and the user has finished signing in:

- `readmate_search_library`
- `readmate_get_document_context`
- `readmate_prepare_listening`
- `readmate_add_web_page`
- `readmate_subscribe_rss`
- `readmate_generate_study_pack`

The three write or paid-AI tools fill visible ReadMate forms and require manual submission. Listening preparation opens the player and selects the requested language, but speech and TTS quota do not begin until the user presses Play. Unsupported browsers continue to run the normal app without an agent-ready badge or an error.

For challenge testing, the ChatGPT in-app browser supports WebMCP without extra registration. For local Chrome testing, use a Chrome build that supports WebMCP and enable `chrome://flags/#enable-webmcp-testing`; an origin-trial token is an optional alternative for Chrome, not a requirement for the in-app-browser judge path. Start the Expo web app, sign in to ReadMate, and inspect the authenticated workspace rather than the public marketing or account-management pages.

Run the deterministic WebMCP contracts and the 20 expected-call, 10 clarification, and 10 refusal evaluation fixtures with:

```bash
npm test -w apps/mobile -- src/webmcp
npm test -w apps/api -- src/webmcp
```

Current limitations are deliberate: WebMCP does not upload local files, extract arbitrary third-party tabs, delete content, manage accounts or billing, purchase plans, return binary audio, or expose full document bodies. Safari and Firefox are not WebMCP targets for this release. Live cross-device proof still requires the owner-approved hostname, Clerk redirects, exact API CORS origin, database migration, supported-browser evaluation, and a signed-in mobile/extension refresh after deployment.

### Challenge verification commands

These checks do not publish anything:

```bash
npm run check:secrets
npm run typecheck
npm test
npm run build
npm run test:firebase-hosting
npm run test:firebase-hosting:emulator
npm run check:publication
```

`check:secrets` scans every file Git could publish plus repository history. The final public release still requires a live-domain browser check because local tests cannot prove DNS, HTTPS, Clerk redirects, production CORS, WebMCP discovery, or authenticated end-to-end behavior.

See `CONTRIBUTING.md` for change and WebMCP-safety expectations, `SECURITY.md` for private vulnerability reporting, and `THIRD_PARTY_NOTICES.md` for bundled third-party software. Run `npm run check:publication:final` after the live app, public repository, and demo-video URLs are present.

## Clerk notes

For production extension auth, configure a stable Chrome extension ID and add its exact `chrome-extension://<YOUR_EXTENSION_ID>` origin to Clerk and `EXTENSION_ORIGIN`. The authenticated web workspace uses the separate exact `WEB_APP_ORIGIN`; both values are required by production API CORS. Release builds require Clerk UI and a live Clerk publishable key.

Avoid putting Clerk calls in content scripts. This project keeps auth in the side panel and sends content-script requests through Chrome messaging.

## Text-to-speech

The extension and mobile app never call speech providers directly. They send text to the backend, which validates the Clerk session and applies rate limiting. English uses Google Cloud Text-to-Speech (or the configured Cartesia option); Twi, Ewe, and Ga use Khaya Text-to-Speech v2 after translation. The challenge candidate bundles the offline Nano-Twi ONNX model as a no-subscription Asante Twi fallback while the current Khaya call quota is exhausted.

Google settings:

- endpoint: `POST https://texttospeech.googleapis.com/v1/text:synthesize`
- default voice: `en-US-Neural2-F`
- supported starter voices: `en-US-Neural2-F`, `en-US-Neural2-D`, `en-US-Neural2-J`, `en-US-Neural2-A`, `en-US-Wavenet-F`, `en-US-Wavenet-D`, `en-US-Wavenet-C`, `en-US-Wavenet-I`, `en-US-Studio-O`, `en-US-Studio-Q`
- credentials: set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON path, set `GOOGLE_SERVICE_ACCOUNT_JSON` to the raw or base64 JSON, or set `GOOGLE_TTS_API_KEY` for key-based local testing if enabled on your Google Cloud project.

Khaya local-language settings:

- synthesis endpoint: `POST https://translation-api.ghananlp.org/tts/v2/synthesize`
- Asante Twi language code: `twi`
- Akuapem Twi language code: `atw`
- Ga language code: `gaa`
- available speakers: `male_low`, `male_high`, `female` (configure with `KHAYA_TTS_SPEAKER_ID`)
- Ga translation endpoint: `POST https://translation-api.ghananlp.org/v2/translate`

The UI should clearly disclose that generated speech is AI-generated.

The Nano-Twi model and native inference runtime are pinned and checksum-verified during the container build. See `THIRD_PARTY_NOTICES.md` for upstream projects, versions, and licenses.

## Permissions and privacy

Requested Chrome permissions are limited to `activeTab`, `contextMenus`, `sidePanel`, `storage`, `scripting`, and the cookies required by Clerk extension authentication, with host access for pages the user asks ReadMate AI to read.

ReadMate AI does not continuously capture the screen. OCR is a Phase 2 placeholder and should use explicit user-initiated screenshot or tab capture only.

The content script ignores hidden text and common navigation/form containers. Production hardening should add blocklists for sensitive domains and form-field extraction safeguards before broad release.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

## Production operations

Google Cloud Run is the canonical API target. The release pipeline runs tests, applies forward-compatible Prisma migrations with a separate migration credential, deploys and verifies an exact no-traffic candidate, records its revision/tag/image evidence, and stops. Production traffic promotion is a separate explicitly confirmed exact-revision action. See `docs/production-readiness-runbook.md` and `docs/cloud-run-deploy.md`.

After deployment, set public client configuration in the relevant build environment:

- `VITE_READMATE_API_URL` in `apps/extension/.env.local` before building the Chrome extension.
- `EXPO_PUBLIC_READMATE_API_URL` in `apps/mobile/.env` before starting or building the mobile app.

Private PDF uploads use the `readmate-uploads` Supabase Storage bucket. The bucket is private; the extension/mobile clients must request signed upload/download URLs through the authenticated backend.

## Phase 2

- User-initiated OCR from screenshot/tab capture.
- AI summary and chat about the current article.
- Vocabulary mode and dyslexia-friendly reading mode.
- Saved audio, queues/playlists, and mobile/web sync.
- Word-level highlighting if reliable timing metadata becomes available.
