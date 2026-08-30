# ReadMate Foundation And Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ReadMate into a synchronized reading, listening, and study product across mobile and Chrome.

**Architecture:** Keep the Express API and Prisma database as the source of truth. Mobile and Chrome read/write the same documents, settings, progress, history, sources, and learning data through shared API routes, with local storage used only as a temporary playback/cache fallback.

**Tech Stack:** Expo Router, React Native, Chrome MV3 React/Vite extension, Express, Prisma/PostgreSQL, Supabase Storage, Google Cloud Text-to-Speech, Google Gemini API.

---

## Current Baseline

- Mobile already has Home, Library, History, Sources, and Settings routes.
- Backend already has document, content, upload, source, settings, RSS refresh, media caching, and Google TTS routes.
- Google TTS is now the only runtime TTS provider.
- URL/RSS/PDF processing exists, including PDF text extraction and card image caching.
- Learning fields already exist on `ReadingDocument`: `summary`, `keyPoints`, `flashcards`, and `quizQuestions`.

## File Structure

- `apps/api/prisma/schema.prisma`: add normalized history, notes, highlights, flashcard review, quiz attempt, sentence/chunk, and Gemini metadata fields.
- `apps/api/src/routes/documents.ts`: keep library, progress, clear-history, and delete semantics strict.
- `apps/api/src/routes/history.ts`: expose dedicated history endpoints that map to the document progress/history model.
- `apps/api/src/routes/sources.ts`: support source search, subscribe, unsubscribe, edit, and source-level counts.
- `apps/api/src/routes/content.ts`: continue URL/RSS/PDF extraction and call the learning generation service after clean text is available.
- `apps/api/src/learning/gemini.ts`: backend-only Gemini client that returns validated structured learning JSON.
- `apps/api/src/learning/schema.ts`: Zod schemas for summaries, key points, flashcards, quizzes, and Ask AI responses.
- `apps/api/src/routes/learning.ts`: summary, flashcard, quiz, Ask AI, and review API endpoints.
- `apps/mobile/app/(tabs)/study.tsx`: Study tab for summaries, cards, quizzes, and review.
- `apps/mobile/app/(tabs)/library.tsx`: permanent saved content only.
- `apps/mobile/app/(tabs)/history.tsx`: clearable activity only.
- `apps/mobile/app/(tabs)/sources.tsx`: source search, RSS subscribe, edit, remove, and PDF upload.
- `apps/mobile/src/components/content-card.tsx`: visual cards with cover image, source, type, topic, progress, time left, and actions.
- `apps/extension/src/sidepanel/App.tsx`: quick actions, now reading, recent history, clear/delete, sync state, and send-to-study entry point.

---

### Task 1: Lock Clear Versus Delete Semantics

**Files:**
- Modify: `apps/api/src/routes/documents.test.ts`
- Modify: `apps/api/src/routes/documents.ts`
- Modify: `apps/mobile/app/(tabs)/history.tsx`
- Modify: `apps/mobile/app/(tabs)/library.tsx`
- Modify: `apps/extension/src/sidepanel/App.tsx`

- [x] **Step 1: Write tests for clear-history preserving library documents**

Add tests in `apps/api/src/routes/documents.test.ts` that create an in-progress document, call `DELETE /api/documents/:id/history`, then assert the document still appears in `GET /api/documents` with `lastReadAt` cleared and progress reset.

- [x] **Step 2: Write tests for delete removing the library document**

Add tests in `apps/api/src/routes/documents.test.ts` that call `DELETE /api/documents/:id`, then assert `GET /api/documents/:id` returns `404` and the item no longer appears in `GET /api/documents`.

- [x] **Step 3: Run the failing tests**

Run:

```bash
npm run test -w apps/api -- documents.test.ts --reporter=verbose
```

Expected before implementation: any missing route semantics fail with assertion differences.

- [x] **Step 4: Implement strict backend behavior**

Ensure `clearDocumentHistory()` only resets `lastReadAt`, `chunkIndex`, `characterOffset`, `percent`, and `status`, while `deleteDocument()` sets `deletedAt` and all list/get queries exclude deleted rows.

- [x] **Step 5: Align mobile and Chrome copy**

Use “Clear history” only for history removal and “Delete from library” only for permanent removal. Permanent deletes must show: `Delete this item from your library? This will remove it from all devices.`

- [x] **Step 6: Verify**

Run:

```bash
npm run test -w apps/api -- documents.test.ts --reporter=verbose
npm run typecheck -w apps/mobile
npm run typecheck -w apps/extension
```

---

### Task 2: Add Dedicated Study Surface

**Files:**
- Create: `apps/mobile/app/(tabs)/study.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Modify: `apps/mobile/app/document/[id].tsx`

- [x] **Step 1: Add Study to mobile navigation**

Add a Study tab that renders learning progress and study cards from existing `summary`, `keyPoints`, `flashcards`, and `quizQuestions`.

- [x] **Step 2: Add document-detail learning sections**

In `apps/mobile/app/document/[id].tsx`, render Summary, Key Points, Flashcards, and Quiz sections when the document has learning data.

- [x] **Step 3: Add study entry actions**

Add a `Study` action to library cards and document detail that links to either `/study` or the document learning section.

- [x] **Step 4: Verify**

Run:

```bash
npm run typecheck -w apps/mobile
```

---

### Task 3: Normalize Source Search And RSS Subscribe

**Files:**
- Modify: `apps/api/src/routes/sources.ts`
- Modify: `apps/api/src/routes/content.ts`
- Modify: `apps/mobile/src/utils/source-suggestions.ts`
- Modify: `apps/mobile/app/(tabs)/sources.tsx`
- Test: `apps/api/src/routes/content.test.ts`

- [x] **Step 1: Test URL, domain, and name input**

Add tests for `CNN`, `engadget.com`, and full RSS URLs. Expected behavior: simple names resolve to suggestions on mobile, domains normalize to `https://`, and RSS URLs create subscribed sources.

- [x] **Step 2: Improve error messages**

Return a 422 JSON error with: `We found this website, but could not detect a readable article or RSS feed. Please check the URL or try another source.`

- [x] **Step 3: Verify RSS item body fallback**

Keep the existing behavior that skips title-only RSS items and saves only items with readable body content.

- [x] **Step 4: Verify**

Run:

```bash
npm run test -w apps/api -- content.test.ts --reporter=verbose
npm run typecheck -w apps/mobile
```

---

### Task 4: Add Gemini Learning Generation

**Files:**
- Create: `apps/api/src/learning/schema.ts`
- Create: `apps/api/src/learning/gemini.ts`
- Create: `apps/api/src/routes/learning.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/content.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/routes/learning.test.ts`

- [x] **Step 1: Add structured learning schema**

Create Zod schemas for:

```ts
summary: { short: string; medium: string[]; detailed: string }
keyPoints: string[]
topicTags: string[]
flashcards: Array<{ question: string; answer: string }>
quiz: Array<{ type: "multiple_choice" | "true_false" | "short_answer" | "fill_blank"; question: string; options?: string[]; correctAnswer: string; explanation: string }>
```

- [x] **Step 2: Add backend-only Gemini client**

Use a server-side `GEMINI_API_KEY`. Mobile and Chrome must never receive or use this key.

- [x] **Step 3: Add learning endpoints**

Expose:

```text
POST /api/learning/:documentId/summary
POST /api/learning/:documentId/flashcards
POST /api/learning/:documentId/quiz
POST /api/learning/:documentId/ask
```

- [x] **Step 4: Store generated output**

Persist summary, key points, topic tags, flashcards, and quizzes back onto the existing document fields first. Add normalized tables in a later migration when editing/review state is implemented.

- [x] **Step 5: Verify**

Run:

```bash
npm run test -w apps/api -- learning.test.ts content.test.ts --reporter=verbose
npm run typecheck -w apps/api
```

---

### Task 5: Add Notes And Highlights

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/routes/notes.ts`
- Create: `apps/api/src/routes/highlights.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/mobile/app/document/[id].tsx`
- Test: `apps/api/src/routes/notes.test.ts`
- Test: `apps/api/src/routes/highlights.test.ts`

- [x] **Step 1: Add Prisma models**

Add `Note` and `Highlight` models with user ownership, document ownership, soft delete timestamps, block index, optional sentence index, and text.

- [x] **Step 2: Add CRUD routes**

Implement:

```text
GET /api/notes
POST /api/notes
PATCH /api/notes/:noteId
DELETE /api/notes/:noteId
GET /api/highlights
POST /api/highlights
DELETE /api/highlights/:highlightId
```

- [x] **Step 3: Verify**

Run:

```bash
npm run test -w apps/api -- notes.test.ts highlights.test.ts --reporter=verbose
npm run typecheck -w apps/api
```

---

### Task 6: Improve Highlight And Resume Accuracy

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/routes/documents.ts`
- Modify: `apps/mobile/src/components/playback-bar.tsx`
- Modify: `apps/extension/src/sidepanel/highlightSegments.ts`
- Test: `apps/extension/src/sidepanel/highlightSegments.test.ts`

- [x] **Step 1: Store sentence position**

Add `sentenceIndex` to progress payloads and persist it alongside `blockIndex`, `characterOffset`, and `percent`.

- [x] **Step 2: Split blocks into sentences**

Use sentence boundaries for sentence mode and whole blocks for paragraph mode.

- [x] **Step 3: Verify**

Run:

```bash
npm run test -w apps/extension -- highlightSegments.test.ts --reporter=verbose
npm run typecheck -w apps/api
npm run typecheck -w apps/mobile
npm run typecheck -w apps/extension
```

---

### Task 7: Production Verification Pass

**Files:**
- Modify: `docs/release-blockers.md`
- Modify: `docs/platform-setup-status.md`

- [x] **Step 1: Run all focused tests**

```bash
npm run test -w apps/api -- --reporter=verbose
npm run test -w apps/extension -- --reporter=verbose
npm run typecheck -w apps/api
npm run typecheck -w apps/mobile
npm run typecheck -w apps/extension
npm run build -w apps/extension
```

- [x] **Step 2: Update release notes**

Record which Phase 1 issues are fixed and which Phase 2-5 items remain.

---

## Spec Coverage Notes

- Phase 1 is covered by Tasks 1-3 and the Study tab in Task 2.
- Phase 2 is partially covered by existing content/RSS/PDF/media code and extended by Task 3.
- Phase 3 is covered by Task 6.
- Phase 4 starts with Task 2 and continues in Tasks 4-5.
- Phase 5 starts with Task 4. A2UI is intentionally excluded from Phase 1 because the core ReadMate UI must remain stable before dynamic study UI is introduced.
