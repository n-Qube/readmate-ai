# ReadMate AI Revamp PRD

## Summary

ReadMate AI should become a cross-device reading companion. The Chrome extension remains the fastest way to capture and listen to desktop web content, while the mobile app lets users continue saved pages, uploaded PDFs, and reading history on iOS and Android.

The key product change is that ReadMate must store the actual reading document, not just a playback event. A user should be able to start a detailed article on desktop, stop halfway through, open the mobile app, and continue from the same section with the same voice and speed.

## Goals

- Preserve detailed website content with minimal loss of context.
- Sync saved pages, uploaded PDFs, reading history, reading progress, and user settings.
- Support Chrome extension, mobile app, and backend from one shared account model.
- Keep Google TTS credentials server-side only.
- Allow anonymous local reading, but require login for cross-device sync.
- Give users clear control over what content is saved and what is sent to TTS providers.

## Non-Goals For The First Mobile MVP

- Continuous screen recording or background OCR.
- Offline full audio caching.
- Native browser extensions on iOS/Android.
- AI chat, summarization, vocabulary mode, and playlist automation.
- Social sharing, public profiles, or collaborative libraries.

## Target Users

- Students reading long scientific papers, technical pages, or PDFs.
- Professionals reading detailed reports, documentation, legal/financial material, and research.
- Users who start reading on desktop but want to continue while commuting or away from the computer.

## User Stories

- As a signed-in user, I can save a webpage from Chrome and see it on my phone.
- As a signed-in user, I can resume an article from the same section where I stopped.
- As a signed-in user, I can upload a PDF and listen to it on desktop or mobile.
- As a user, I can choose a Google TTS voice.
- As a user, I can choose voice, speed, and reading style.
- As a user, I can delete saved pages and uploaded files.
- As an anonymous user, I can listen locally in Chrome without account sync.

## Product Surfaces

### Chrome Extension

- Side panel reader.
- Floating player.
- Context-menu action for selected text.
- "Read page" and "Save for later".
- Settings for voice, speed, highlight mode, and auto-scroll.
- Signed-in sync state.

### Mobile App

- Login/signup.
- Continue reading.
- Library of saved webpages and PDFs.
- Reader/player screen.
- PDF upload from Files.
- Share URL into ReadMate.
- Settings.
- Account/data deletion screen.

### Backend

- Authenticated document API.
- TTS proxy API.
- File upload API.
- Progress sync API.
- Provider/user settings API.

## Core Workflows

### Save And Read Webpage From Chrome

1. User clicks "Read page" or "Save for later".
2. Extension extracts structured content blocks from the page.
3. Extension sends the document to the backend.
4. Backend stores the document, blocks, source URL, title, and metadata.
5. Extension starts playback.
6. Progress updates after each block.
7. Mobile app can load the same document and resume.

### Continue On Mobile

1. User opens the mobile app.
2. App loads "Continue reading" from synced progress.
3. User taps an article.
4. App requests TTS for the current block from the backend.
5. Progress syncs as playback advances.

### Upload PDF

1. User uploads a PDF in Chrome or mobile.
2. Backend stores the original PDF file.
3. Text extraction runs client-side for MVP or server-side later.
4. Extracted blocks are saved as a reading document.
5. Playback uses the same document/progress model.

## Backend Recommendation

Use Supabase as the data and storage layer, with Clerk for auth.

- Supabase Postgres: reading documents, blocks, progress, sessions, user settings.
- Supabase Storage: uploaded PDFs and future cached audio.
- Clerk: login, signup, account identity, session tokens.
- Existing Node/Express API: TTS proxy, provider routing, rate limits, server-side secrets.

The backend API remains the primary integration point for both Chrome and mobile. Supabase is the source of truth for app data, not a replacement for the TTS proxy.

## Data Model

### users

Synced from Clerk identity.

- `id`
- `clerk_user_id`
- `email`
- `created_at`
- `updated_at`

### reading_documents

- `id`
- `user_id`
- `title`
- `source_type`: `webpage`, `selection`, `pdf`, `ocr`
- `source_url`
- `canonical_url`
- `status`: `ready`, `processing`, `failed`
- `created_at`
- `updated_at`
- `last_read_at`

### reading_blocks

- `id`
- `document_id`
- `order_index`
- `block_type`: `heading`, `paragraph`, `list_item`, `blockquote`, `pdf_page`
- `text`
- `source_selector`
- `source_page_number`
- `created_at`

### reading_progress

- `id`
- `user_id`
- `document_id`
- `block_index`
- `character_offset`
- `percent`
- `provider`
- `voice`
- `speed`
- `updated_at`

### reading_sessions

- `id`
- `user_id`
- `document_id`
- `started_at`
- `ended_at`
- `total_listening_seconds`
- `progress_percent`

### uploaded_files

- `id`
- `user_id`
- `document_id`
- `storage_bucket`
- `storage_path`
- `mime_type`
- `size_bytes`
- `created_at`

### user_settings

- `user_id`
- `tts_provider`
- `voice`
- `speed`
- `instructions`
- `highlight_mode`
- `auto_scroll`
- `updated_at`

## API Requirements

- `POST /api/documents`
- `GET /api/documents`
- `GET /api/documents/:id`
- `PATCH /api/documents/:id/progress`
- `DELETE /api/documents/:id`
- `POST /api/uploads/pdf`
- `POST /api/tts`
- `GET /api/settings`
- `PATCH /api/settings`

## Mobile MVP Acceptance Criteria

- User can install a test build on iOS or Android.
- User can sign in with Clerk.
- User can see documents saved from Chrome.
- User can resume the latest document from saved progress.
- User can play/pause/stop/rewind/forward.
- User can choose a Google TTS voice.
- User can upload a PDF.
- User can delete a saved document.
- Chrome and mobile show the same library after sync.
- API keys remain server-side only.

## Privacy Requirements

- Save content only after explicit user action.
- Show when text is sent to the backend/TTS provider.
- Do not capture passwords, payment fields, private form fields, or hidden text.
- Allow users to delete documents and uploaded PDFs.
- Keep anonymous mode local-only.

## Phase 2 Ideas

- OCR from explicit screenshot/tab capture.
- AI summary and ask-about-this-page.
- Offline cached audio.
- Playlist/queue.
- Full-text search.
- Vector search over saved documents.
- Word-level highlighting if reliable timing metadata becomes available.
