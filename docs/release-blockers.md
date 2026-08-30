# ReadMate AI Release Blockers

Last updated: 2026-08-24

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
