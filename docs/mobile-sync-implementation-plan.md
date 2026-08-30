# ReadMate AI Mobile Sync Implementation Plan

## Recommendation

Build the mobile app with Expo React Native and keep the backend as the source of truth.

Recommended stack:

- Mobile: Expo React Native, TypeScript, Expo Router.
- Auth: Clerk.
- Data: Supabase Postgres.
- File storage: Supabase Storage.
- Backend API: existing Node/Express API, expanded.
- TTS: server-side Google Cloud Text-to-Speech.

## Current State

ReadMate already has:

- Chrome MV3 extension.
- Side panel UI.
- Floating player.
- Webpage and selection extraction.
- PDF upload extraction.
- Google TTS backend support.
- Clerk wiring in the API.
- Local-only history fallback.

Important current gap:

- The app saves reading history locally, but does not yet persist complete reading documents to a shared backend that mobile can consume.

## Target Architecture

```text
Chrome Extension  ─┐
                   ├── ReadMate API ── Supabase Postgres
Mobile App       ──┘          │
                              ├── Supabase Storage
                              └── Google Cloud TTS

Clerk Auth issues user identity/session tokens for both Chrome and mobile.
```

## Milestone 1: Backend Data Foundation

Goal: make saved documents and progress real backend resources.

Tasks:

- Create Supabase project.
- Add Supabase database URL to backend.
- Update Prisma schema or migrate to Supabase SQL migrations.
- Add tables:
  - `users`
  - `reading_documents`
  - `reading_blocks`
  - `reading_progress`
  - `reading_sessions`
  - `uploaded_files`
  - `user_settings`
- Add backend auth middleware that maps Clerk user to internal user row.
- Add document CRUD endpoints.
- Add progress update endpoint.
- Add settings endpoints.
- Add tests for document creation, listing, progress update, and auth boundaries.

Acceptance:

- Authenticated API can create a document with ordered blocks.
- Authenticated API can list only the signed-in user's documents.
- Progress can be updated and fetched.
- Anonymous users cannot write synced history.

## Milestone 2: Chrome Extension Sync Revamp

Goal: Chrome saves real documents that mobile can resume.

Tasks:

- Add "Save for later" action.
- Update "Read page" to create or reuse a backend document when signed in.
- Send structured blocks to `POST /api/documents`.
- Save progress to `PATCH /api/documents/:id/progress`.
- Show synced/local status in side panel.
- Keep anonymous local-only mode.
- Add graceful fallback if backend is unavailable.

Acceptance:

- Signed-in user can read a webpage in Chrome and see it in backend document list.
- Reading progress updates as playback moves through blocks.
- Reloading Chrome side panel restores the latest progress.
- Anonymous mode still works locally.

## Milestone 3: Mobile App Scaffold

Goal: create a testable mobile app shell.

Tasks:

- Add `apps/mobile`.
- Initialize Expo + TypeScript.
- Add Expo Router.
- Add Clerk Expo auth.
- Add API client shared with extension where possible.
- Add screens:
  - sign in
  - continue reading
  - library
  - reader/player
  - settings
  - account
- Configure EAS project.

Acceptance:

- App runs locally in Expo Go or development build.
- User can sign in.
- App can call `GET /api/documents`.
- App shows an empty library state.

## Milestone 4: Mobile Library And Continue Reading

Goal: mobile can resume desktop-saved articles.

Tasks:

- Load document list from backend.
- Add "Continue reading" card using latest `reading_progress`.
- Add document detail screen.
- Add player controls.
- Call `POST /api/tts` for the current block.
- Save progress after each block.
- Add provider, voice, speed, and instructions settings.

Acceptance:

- Save article in Chrome.
- Open mobile app.
- Article appears in library.
- Tap article and resume from saved progress.
- Playback advances and progress syncs back.

## Milestone 5: PDF Upload On Mobile

Goal: mobile users can upload and listen to PDFs.

Tasks:

- Add document picker.
- Upload PDF to backend or Supabase Storage via signed upload flow.
- Extract text:
  - MVP: mobile/client extraction if reliable.
  - Preferred follow-up: server-side extraction job.
- Save extracted blocks as a reading document.
- Add PDF status states: uploading, processing, ready, failed.

Acceptance:

- User uploads PDF from phone.
- PDF appears in library.
- User can listen to extracted text.
- User can resume PDF from saved progress.

## Milestone 6: Test Build Distribution

Goal: get the mobile app onto real phones.

Tasks:

- Configure Expo app identifiers.
- Configure environment variables.
- Create EAS development build.
- Test iOS and Android if available.
- Add README setup for mobile.
- Add smoke-test checklist.

Acceptance:

- Mobile test build can be installed.
- Sign in works.
- Library sync works.
- Playback works with Google TTS.
- Progress sync works between Chrome and mobile.

## Implementation Order

1. Backend document/progress APIs.
2. Chrome sync integration.
3. Mobile scaffold.
4. Mobile library.
5. Mobile playback.
6. PDF upload.
7. Test builds.

This order avoids building a mobile UI that has nothing reliable to sync with.

## Risks And Decisions

### Clerk + Supabase

Decision: use Clerk for auth, Supabase for app data/storage.

Risk: JWT/RLS setup can be easy to misconfigure.

Mitigation: initially route all app data through the backend API. Add Supabase Row Level Security before any direct client reads.

### TTS Cost

Risk: mobile and Chrome can create many TTS requests.

Mitigation:

- Rate-limit per user.
- Cache generated audio later.
- Store usage events.
- Keep text chunk size large enough for context but under provider/API limits.

### PDF Extraction

Risk: PDF extraction differs between browser/mobile/server.

Mitigation: use client extraction for MVP where possible, then move to server-side extraction for consistency.

### Content Fidelity

Risk: scientific pages lose equations, tables, figure captions, and references if extraction is too simple.

Mitigation:

- Preserve ordered blocks.
- Store block type and selector.
- Add table/caption/code-block support after MVP.
- Add "view original" link.

## First Sprint Checklist

- [ ] Create Supabase project.
- [ ] Add Supabase connection to backend env.
- [ ] Replace local history-only persistence with backend documents.
- [ ] Implement `POST /api/documents`.
- [ ] Implement `GET /api/documents`.
- [ ] Implement `PATCH /api/documents/:id/progress`.
- [ ] Update Chrome `Read page` to save document when signed in.
- [ ] Add smoke test: Chrome save -> backend list -> progress update.

## Second Sprint Checklist

- [ ] Scaffold `apps/mobile`.
- [ ] Add Clerk login.
- [ ] Add authenticated API client.
- [ ] Add library screen.
- [ ] Add continue-reading screen.
- [ ] Add reader/player screen.
- [ ] Add Google TTS playback test.
- [ ] Create first EAS development build.

## Test Scenario For Demo

1. Sign in on Chrome extension.
2. Open a CNN article or scientific page.
3. Click "Read page".
4. Stop after the second reading block.
5. Open mobile app.
6. Confirm the article appears under "Continue reading".
7. Tap it.
8. Confirm playback resumes from the saved block.
9. Let mobile finish another block.
10. Reopen Chrome and confirm progress moved forward.
