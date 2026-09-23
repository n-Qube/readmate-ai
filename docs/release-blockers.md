# ReadMate AI Release Blockers

Last updated: 2026-09-23

## 2026-09-23 production-readiness review

Reviewed against `docs/readmate-revamp-prd.md` and `docs/ReadMate-WebMCP-Product-Requirements-and-Implementation-Plan.docx`. Status: **NO-GO** until the P0 items below are closed.

Verified in a clean install outside iCloud with Node 22: `typecheck` passes for API, extension and mobile; 626 Vitest tests pass (API 311, extension 149, mobile 166) plus 22 Firebase hosting tests; `npm run build` passes; `npm run check:dependencies` passes; the Prisma schema validates.

### P0: blocks any production release

1. **Treat GitHub as the only source of truth.** `n-Qube/readmate-ai` holds the 2026-08-30 challenge release. The local working copy it was published from is not linked to that remote: its git history is unrelated, its last commit is from 2026-05-28, and it tracks only 15 files. Changes made since the release were applied through a pull request. From now on, work from a clone of `n-Qube/readmate-ai`, require a green CI run (`.github/workflows/ci.yml`) before merging, and deploy only from commits on `main`.
2. **The working copy lives in iCloud Drive with storage optimization on.** About 152k of 164k `node_modules` files, most of `apps/mobile/ios` and `apps/mobile/android`, and the native AirPlay/Cast module source (`ReadMateAirPlayModule.swift`, `ReadMateAirPlayModule.kt`, podspec) are evicted to the cloud (`dataless`). Reads block for about 25 s per file, so local `typecheck`, `test` and native builds hang. iCloud also created conflict copies (`* 2.*`). One of them, `app/(tabs)/index 2.tsx`, was a live Expo Router route, and another duplicated the Swift module class. Eight stale copies in source directories were moved to `~/readmate-sync-conflicts-2026-09-23/`. Fix: move the repository out of `~/Documents` (for example to `~/Developer/readmate`), or mark the folder "Keep Downloaded". Then run `npm ci`.
3. **Local Node is 20.19.6 but `package.json` requires Node 22.13 or later.** `.nvmrc` now pins 22, so run `nvm use` in the repo. Homebrew `node@22` (22.22.0) is installed. Put it first on `PATH` or pin it with `.nvmrc`.
4. **The external gates from 2026-08-24 are still unevidenced.** These are credential rotation, migrations applied by the migration role, Secret Manager, Clerk production configuration, the EAS production environment and new binaries, a backup restore drill, monitoring, and budget alerts. See the section below. None of them can be verified from the repository.

### P0 for the Gemini TTS release (added 2026-09-23)

- **Live smoke test.** Google's documentation gives two different response shapes for the Interactions API (`output_audio.data` versus `{type:"audio"}` blocks in `steps`). The client accepts both, plus legacy `inlineData`. Only unit tests cover this path so far. After deploying a candidate, run this once for each provider:

  ```bash
  curl -X POST https://<candidate>/api/tts -H 'Authorization: Bearer <clerk-session-token>' -H 'Content-Type: application/json' \
    --data '{"text":"ReadMate Gemini smoke test.","provider":"gemini-lite","voice":"Kore","speed":1}' --output /tmp/gemini-lite.wav
  ```

  Repeat with `"provider":"gemini"` using a Premium account. Check latency, the `X-ReadMate-TTS-Provider` header, and that the WAV plays.
- **Pricing and quota.** The documentation does not give GA status, pricing or rate limits for `gemini-3.8-flash-tts` or `gemini-3.8-flash-lite-tts`. Confirm them in the Google Cloud console. Then set `FREE_TTS_DAILY_CHAR_LIMIT` and `PREMIUM_TTS_DAILY_CHAR_LIMIT` to match, and add a billing budget alert on the Gemini API key. Flash-Lite is enabled on the Free plan.
- **Apply migration `20260923120000_retire_cartesia_tts`.** It moves saved `cartesia` settings to `gemini`/`Kore`. The API also normalizes `cartesia` → `gemini` on every read and write, so the order of migration and deploy does not matter.
- **Retire Cartesia infrastructure after the deploy.** Revoke the Cartesia API key, delete the `readmate-cartesia-api-key` Secret Manager entry, and confirm that the new Cloud Run revision no longer references `CARTESIA_*` values. The deploy scripts no longer set them.
- **Test on real devices.** Gemini returns 24 kHz mono WAV, about 2.9 MB per minute. That is larger than Google MP3. Confirm iOS and Android playback, the lock screen, and Chromecast/AirPlay casting, and check mobile data use on long documents.

### P0: GitHub Actions cannot run

- Every CI run on `n-Qube/readmate-ai` fails before starting: "The job was not started because your account is locked due to a billing issue." Resolve it in the GitHub billing settings for the account. Until then, run `npm ci && npm run verify:release` on a clean clone before merging. On 2026-09-23 this passed for PR #1.

### P1: performance (fixed 2026-09-23; verify on devices)

- **Mobile no longer downloads every document's text with the library.**
  - Lists call `GET /api/documents?view=summary`. It returns the same shape without reading blocks or stored HTML, plus `blockCount`.
  - Progress saves use `PATCH /api/documents/:id/progress?view=summary`.
  - Playback loads a document in full on first play, sharing the document screen's `["document", id]` cache. A summary item never replaces text that is already loaded (`withKnownBlocks`).
  - Default API responses are unchanged, so installed app builds keep working. **Deploy the API before shipping the new mobile build**: older APIs reject `view` with a 400.
  - **Device check:** play from Home, Library and History; resume mid-document; skip blocks; use lock-screen controls and Cast; switch items while one is loading.
- **Flashcards and quiz regenerate on their own.** `/api/learning/:id/flashcards` and `/quiz` call focused Gemini prompts with single-part schemas. They previously generated a whole pack, which tripled cost and replaced the *other* part in the review store, orphaning quiz attempts. Syncs now touch only the part that was generated.
- **AI quota is refunded** when the Gemini call fails and fallback content is served, including for Ask AI (`releaseDailyUsage`).

### P1: product requirements gaps

- **Share into ReadMate is on for Android and ready for iOS.** `expo-share-intent@7.0.0` (Expo SDK 56) adds an Android `SEND text/*` filter, verified with `expo prebuild`. A shared link opens Add content pre-filled, and the user taps Add to save it. iOS is configured but switched off (`"disableIOS": true` in `app.json`) because the Share Extension needs its own identifiers. To enable it:
  1. In the Apple Developer portal, register the extension's bundle ID (`ai.readmate.mobile.share-extension`) and add the existing App Group `group.ai.readmate.mobile` to it.
  2. Set `disableIOS` to `false`.
  3. Run `eas build -p ios` interactively once so EAS creates the provisioning profile.
  4. Test sharing from Safari on a device.
- **Learning model access.** Learning features default to `GEMINI_MODEL=gemini-2.5-flash`. There is no shutdown date, but Google now limits 2.5 access to projects that have used it before. A new GCP project or API key would lose access. Plan a move to a 3.x model, and re-validate the structured study output before switching.
- **WebMCP production origin.** Chrome serves WebMCP behind an origin trial (Chrome 153+). Register the trial for the final `WEB_APP_ORIGIN` and deploy with `npm run deploy:firebase-hosting:guarded` so the `Origin-Trial` header is injected. Add the origin to the Clerk allowed origins and to the API `WEB_APP_ORIGIN`.
- **Extension version** is bumped to `0.1.6` in `package.json`, `manifest.json` and the lockfile.

### Fixed in this review

- **Gemini 3.8 Flash TTS and Flash-Lite TTS added** as providers `gemini` (Premium) and `gemini-lite` (all plans) through the existing `GEMINI_API_KEY`. The request uses `store: false`. Text is split into sentence-bounded sections, synthesized three at a time, retried on 408, 429 and 5xx, and merged into WAV. Upstream error bodies are never echoed back. The 30 prebuilt voices are available in the API, extension and WebMCP. Mobile shows eight curated reading voices.
- **Cartesia removed** from the API, extension, mobile, deploy scripts and environment templates. Saved and legacy-client `cartesia` selections migrate to Gemini Flash. `GET /api/tts/voices` now returns the Gemini catalogue, so installed app builds keep working.
- **Playback speed was applied twice.** Clients sent `speed` to the server, where Google baked it in with `speakingRate`, and then set `playbackRate` again, so 1.5× played at about 2.25×. Local playback now requests neutral-rate audio. Android Cast URLs keep speed baked in and play at rate 1.
- **The dependency gate failed in CI.** `sharp` in the API runtime had libheif CVEs, and `@xmldom/xmldom`, `js-yaml` and `browserslist` in Expo tooling had high advisories. Fixed with in-major patch bumps and overrides.
- **Extension TTS disclosure.** The privacy card now names the provider that receives text on Play, as the PRD privacy requirement asks.
- **Extension voice Preview button.** It had no click handler and was covered by the overlay `<select>`. It now plays a short sample.
- **Extension premium provider.** Free accounts see Gemini Flash as locked instead of failing at playback.
- **AI study packs were most likely failing into fallback.** On `gemini-2.5-flash`, thinking tokens shared the 8,192-token output cap, which truncated the JSON, and the call inherited the 15 s outbound timeout. Thinking is now off for 2.5 Flash, output is capped at 16,384 tokens, generation has its own 45 s deadline (`GEMINI_LEARNING_TIMEOUT_MS`), and truncated or blocked responses are logged explicitly. Fallback content no longer overwrites a saved study set (`preserved: true`). Both apps now tell users when material is quick notes rather than AI output. **Verify live:** generate a 24-card, 12-question pack on a long document and confirm `fallback: false`.
- **Rate limits.** Content ingestion, uploads, sources, account deletion and all data routes are now per-user rate limited, not only TTS and learning. Limits are keyed through `getAuth()` rather than the deprecated `req.auth` proxy. `trust proxy` is set for Cloud Run, and 429 responses are JSON.
- **Security.** Added nosniff, `X-Frame-Options: DENY`, `no-referrer`, a deny-by-default CSP, and HSTS in production. Removed `X-Powered-By`. The extension no longer treats a raw session token left by an older build as a signed-in session.
- **UI dead-ends.**
  - Mobile Library's ☰ button did nothing; it now cycles through sort orders.
  - The "Documents" chip was truncated at 375 px; it now reads "Docs".
  - Home's "…" button had no action; it was removed.
  - The extension popup's PDF and Save buttons were permanently disabled; they now open the side panel.
- **WebMCP.** Added Chrome's `consequentialHint` annotation: true for the three write tools, false for the read and listening tools. The six PRD tools, declarative forms without `toolautosubmit`, `respondWith`, abort-signal registration, redacted output envelopes, audit and idempotency, and the 40-case evaluation set were already present and match Chrome's current API.

## 2026-08-24 production-readiness gate

The repository fixes for the 18-item security audit are implemented locally, but production remains **NO-GO** until the external gates below are evidenced:

- Rotate and revoke every credential formerly stored in workspace plaintext or Expo logs, purge recoverable copies, and pass `npm run check:secrets:workspace`.
- Commit the canonical source and verify `npm ci && npm run verify:release` from a clean clone. The audited worktree was not a reliable source of truth because most application files were untracked.
- Apply the new usage-quota/RLS migrations with the migration role; verify the runtime database user is exactly `readmate_api`.
- Create the required Secret Manager entries and Cloud Run service identity, then deploy through the candidate/promotion pipeline.
- Configure and verify the production Clerk instance, live keys, strict reverification, OAuth redirects, attack protection, and the stable extension origin.
- Populate the EAS production environment, generate new binaries containing the Chromecast HTTPS change, and complete real-device cast/auth/sign-out/deletion tests.
- Complete a backup restore drill and configure monitoring, on-call routes, and provider budget alerts described in `docs/production-readiness-runbook.md`.

The historical states below are retained as chronology and must not be interpreted as current verification.

## Completed Platform Foundation

- Supabase project created: `readmate-ai` / `favamqxfuzhrbgbousjw`.
- Supabase database migrations applied.
- Private Supabase Storage bucket created: `readmate-uploads`.
- Expo project created and linked: `@nii.nortey/readmate-ai`.
- Google Cloud TTS service account is present and Google TTS smoke test succeeds.
- Google Play app shell created: `ReadMate AI` / `ai.readmate.mobile` / app ID `4974877436753122587`.
- Apple Developer bundle ID registered: `ReadMate AI` / `ai.readmate.mobile`.
- App Store Connect app shell created: `ReadMate AI` / Apple app ID `6772259378`.
- Store listing copy and privacy/data-safety baseline drafted in `docs/store-metadata.md`.
- Internal testing path documented in `docs/internal-testing.md`.
- TTS is now Google-only; the previous secondary provider quota issue is no longer a launch blocker.
- Phase 1 sync semantics are implemented: clear history preserves Library items, delete removes saved content across clients, and progress now stores sentence position.
- Mobile now has a Study tab plus document-level summary, key point, flashcard, quiz, note, and highlight surfaces.
- Backend Gemini learning endpoints, notes endpoints, and highlights endpoints are implemented behind authenticated API routes.
- Learning review state is normalized with flashcard review status, quiz attempts, retrieval-ranked Ask AI, and trusted study UI descriptors.
- Chrome add-on side panel redesigned as a compact companion with sync status, focused Now Reading, primary capture actions, Quick Study Lite, capped Recent History, and separate Clear/Delete actions.

## Backend Deployment

Current production target: Google Cloud Run.

Current deployed API:

- Service: `readmate-api`
- Region: `us-central1`
- URL: `https://readmate-api-olm4au6qra-uc.a.run.app`
- Latest verified revision: `readmate-api-00028-k25`
- Cloud Build ID: `035f9df7-dd64-4ba4-8644-9e38938a9804`
- Production database migration `20260527170000_learning_review_state` applied.
- Authenticated smoke test passed for save selection, Gemini learning generation, review state, flashcard review status, quiz attempt scoring, trusted study UI descriptors, Ask AI, delete cleanup, Clerk session cleanup, and Gemini temporary-overload fallback.

Required production env vars:

```text
DATABASE_URL=
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=
SUPABASE_URL=https://favamqxfuzhrbgbousjw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=readmate-uploads
GOOGLE_APPLICATION_CREDENTIALS=
GOOGLE_SERVICE_ACCOUNT_JSON=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
EXTENSION_ORIGIN=
ALLOW_ANONYMOUS_TTS=false
```

Production smoke tests:

```bash
curl https://<api-host>/health
curl -X POST https://<api-host>/api/tts \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <clerk-session-token>' \
  --data '{"text":"ReadMate production test.","provider":"google","voice":"en-US-Neural2-F","speed":1}' \
  --output /tmp/readmate-production-test.mp3
```

## Clerk

Create or verify these redirect/origin entries before mobile testing:

- Expo/mobile scheme: `readmate://`
- iOS bundle identifier: `ai.readmate.mobile`
- Android package: `ai.readmate.mobile`
- Chrome extension origin after extension ID is stable: `chrome-extension://<extension-id>`
- Production API origin after backend deploy.

## Google Play Console

Created app shell:

- App name: `ReadMate AI`
- Package name: `ai.readmate.mobile`
- Google Play app ID: `4974877436753122587`
- Type: App
- Pricing: Free
- Default language: English (United States)

Current release state:

- Internal testing is active for version `1.0`, version code `41`.
- Closed testing (`alpha`) has a draft release named `1.0 closed testing` using version code `41`.
- Main store listing copy is committed for English (United States).
- Store listing assets are committed: 512px icon, 1024x500 feature graphic, and five phone screenshots.
- Store contact website is `https://readmate-api-olm4au6qra-uc.a.run.app/`.
- Store contact email is `nii.nortey@gmail.com`, matching the published ReadMate contact/privacy pages.

Remaining setup:

- Complete Play Console policy forms that are not covered by the Android Publisher API, including Data safety, App access, Ads, Content rating, Target audience, and privacy/deletion declarations.
- Use `docs/play-console-policy-answers.md` for the current ReadMate-specific answers to those forms.
- Add or verify the closed-testing tester list or Google Group.
- Send the draft closed-testing release for review from Play Console.
- For production access on a new Play developer account, run the required closed test before applying for production.

Required before first internal build submission:

- Public API URL is configured in the `store-internal` EAS build profile as `https://readmate-api-olm4au6qra-uc.a.run.app`.
- Google Play release service account or manual upload access.
- Tester list or Google Group.
- Any Google Play console forms required before internal rollout.

## App Store Connect

Apple Developer identifier created:

- Bundle ID: `ai.readmate.mobile`
- Description: `ReadMate AI`
- Capabilities: no push notifications required for MVP.

App Store Connect app created:

- Name: `ReadMate AI`
- Apple app ID: `6772259378`
- SKU: `readmate-ai-ios`
- Primary language: English (U.S.)
- Bundle ID: `ai.readmate.mobile`
- Distribution: TestFlight first.

Current release state:

- Public API URL is configured in the `store-internal` EAS build profile as `https://readmate-api-olm4au6qra-uc.a.run.app`.
- iOS store build `112` completed in EAS under build ID `39f3e60e-6c03-4e7b-91d4-a367e0d74a5a`.
- EAS submission `919a7d8d-e4d8-4e24-ad9c-e16540ff8cf0` is queued for App Store Connect app `6772259378`.

Required before TestFlight testing:

- Wait for EAS/App Store Connect upload and Apple processing for build `112`.
- Attach build `112` to the TestFlight group after processing.
- Submit the external TestFlight build for Beta App Review if prompted.
- Add or reactivate external testers after App Store Connect accepts tester changes.

## EAS Build Commands

Use these after the backend URL and Clerk mobile redirects are configured:

```bash
npm run typecheck -w apps/mobile
npx eas-cli@latest build -p android --profile preview
npx eas-cli@latest build -p ios --profile preview
```

For store submission:

```bash
npx eas-cli@latest build -p android --profile production
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p android --profile production
npx eas-cli@latest submit -p ios --profile production
```

## Text-to-Speech

- Google Cloud Text-to-Speech is the only supported provider.
- Legacy secondary-provider selections are normalized to Google in the API.

## Learning Mode

- Gemini is the backend-only learning provider.
- Required before production learning smoke tests: set `GEMINI_API_KEY` on the deployed API.
- Implemented learning routes: `/api/learning/:documentId/summary`, `/api/learning/:documentId/flashcards`, `/api/learning/:documentId/quiz`, `/api/learning/:documentId/ask`, `/api/learning/:documentId/review`, `/api/learning/:documentId/ui`, `/api/learning/:documentId/flashcards/:flashcardId/review`, `/api/learning/:documentId/quiz/attempts`, and `/api/learning/review`.
- Temporary Gemini overload, quota, timeout, or unavailable errors now fall back to extractive study material from the saved document text instead of blocking Summary, Key points, Flashcards, Quiz, Ask AI, or Send to Study.

## Chrome Add-On

- Side panel UX now defaults to a compact header, sync pill, focused Now Reading card, two-by-two action grid, collapsed Quick Study, collapsed account/settings, and Recent History capped to five items.
- Quick Study Lite supports summary, key points, Ask AI, Save highlight via selected text capture, and Send to Study through backend routes only.
- Recent History uses compact rows with Resume as the primary action and an overflow menu for Open, Clear from history, Study, and Delete from library.
- Verified on 2026-05-27:
  - `npm run test -w apps/extension -- --reporter=verbose` passed: 7 files, 35 tests.
  - `npm run typecheck -w apps/extension` passed.
  - `npm run build -w apps/extension` passed with the existing large chunk warning.
  - Live Chrome side panel no longer shows the Gemini high-demand failure for Send to Study; it returns synced state and "Study material is ready."
