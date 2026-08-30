# ReadMate AI Platform Setup Status

Last checked: 2026-05-27

## Clerk

- Dashboard app: ReadMate AI
- Instance: development
- Publishable key configured locally for Expo and Chrome extension.
- Frontend API URL: `https://clever-sparrow-15.clerk.accounts.dev`
- Backend API URL: `https://api.clerk.com`
- Required next check before production: enable/configure Native API and native app entries for `ai.readmate.mobile`.

## Supabase

- Visible organization: `n-Qube Interactive`
- ReadMate project: `readmate-ai`
- Project ref: `favamqxfuzhrbgbousjw`
- Project URL: `https://favamqxfuzhrbgbousjw.supabase.co`
- Region: Central EU (Frankfurt), `eu-central-1`
- Compute: Nano
- Backend `DATABASE_URL` is configured locally in `.env.local` using Supabase's IPv4 session pooler because the direct database connection is IPv6-only.
- Prisma migrations through `20260527114500_progress_sentence_index` exist locally; apply the newer learning/sync migrations before production verification.
- Verified tables now include planned models for `ReadingDocument`, `ReadingBlock`, `ReadingSession`, `UserSettings`, `UploadedFile`, `Note`, and `Highlight`.
- Private Storage bucket `readmate-uploads` exists, is not public, allows PDFs, and has a 50 MB file limit.
- Previous project `sunrise_dev` / `pqfnibkjcgpgqrcvxdtf` is paused and not used for ReadMate AI.

## Google Cloud

- Project: `billbridge-c684f`
- Service account present: `readmate-ai-tts@billbridge-c684f.iam.gserviceaccount.com`
- Production Cloud Run uses the attached service account through Google metadata; the plaintext `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable was removed in revision `readmate-api-00057-5nh` on 2026-08-25.
- The user-managed key created 2026-05-22 was deleted on 2026-08-25, and the local `.secrets/google-tts-service-account.json` credential file was removed.
- Backend smoke test: Google TTS returned MP3 audio successfully.

## Text-to-Speech

- Google Cloud Text-to-Speech is the only supported provider.
- Legacy secondary-provider selections are normalized to Google by the backend.

## Learning Mode

- Backend uses Gemini through server-side `GEMINI_API_KEY`; clients do not call Gemini directly.
- Implemented local API routes for summary generation, flashcards, quiz generation, Ask AI, notes, and highlights.
- Production still needs deployed `GEMINI_API_KEY` and a live learning smoke test.

## Expo

- Account: `nii.nortey`
- Existing projects: `trustloan-agent`, `trustloan-customer`, `sunrise`
- ReadMate AI Expo project created: `@nii.nortey/readmate-ai`
- Project URL: `https://expo.dev/accounts/nii.nortey/projects/readmate-ai`
- Project ID: `ba97c283-2128-48b8-b42a-dc257773f59c`
- Local EAS config has been added.
- Local mobile config is linked through `extra.eas.projectId`.

## Vercel

- CLI account: `n-qube`
- API project creation attempted: `readmate-ai-api`
- Status: blocked by Vercel `402` overdue team balance.
- Local API deployment config exists in `apps/api/vercel.json` and `apps/api/api/index.ts`.

## Google Play Console

- Developer account: `N-QUBE INTERACTIVE`
- Account ID: `7370611043652264264`
- ReadMate AI app shell created.
- App name: `ReadMate AI`
- Package: `ai.readmate.mobile`
- Google Play app ID: `4974877436753122587`
- Default language: English (United States)
- Type/pricing: App, Free
- Store listing copy and privacy/data-safety baseline drafted in `docs/store-metadata.md`.
- Internal testing path drafted in `docs/internal-testing.md`.
- Remaining blocker: deploy the API to a public URL, create an Android store build, upload it to the internal track, and add testers.

## App Store Connect

- Team/account visible under Daniel Nortey.
- Apple Developer bundle ID registered: `ReadMate AI` / `ai.readmate.mobile`.
- ReadMate AI App Store Connect app shell created.
- Apple app ID: `6772259378`
- SKU: `readmate-ai-ios`
- Primary language: English (U.S.)
- Store listing copy and privacy/app-review baseline drafted in `docs/store-metadata.md`.
- Internal testing path drafted in `docs/internal-testing.md`.
- Remaining blocker: deploy the API to a public URL, create an iOS store build, wait for TestFlight processing, and add internal testers.
