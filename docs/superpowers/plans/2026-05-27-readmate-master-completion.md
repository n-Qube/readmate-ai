# ReadMate Master Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining ReadMate master requirements beyond the deployed foundation: durable learning state, review workflows, long-document Ask AI retrieval, dynamic study UI descriptors, app internal distribution, and end-to-end QA.

**Architecture:** Keep the backend as the source of truth. Add normalized learning tables for review state while preserving the existing document summary/key point/flashcard/quiz fields for backward compatibility. Mobile and Chrome should call backend learning endpoints only; Gemini stays server-side.

**Tech Stack:** Express, Prisma/PostgreSQL, Gemini API, Expo Router, React Native, Chrome MV3 React/Vite, EAS, Cloud Run.

---

## Current Verified Baseline

- Cloud Run API is deployed at `https://readmate-api-olm4au6qra-uc.a.run.app`.
- Production revision `readmate-api-00026-pf8` serves 100 percent traffic.
- Authenticated smoke tests passed for save selection, progress, notes, highlights, Gemini summary, Ask AI, settings, and cleanup.
- Mobile has Home, Library, History, Sources, Study, and Settings tabs.
- Chrome extension has a built `dist` folder and local release zip artifacts.
- EAS store builds exist for Android and iOS, but store submission status is not confirmed.

## Remaining Completion Units

- `apps/api/prisma/schema.prisma`: add normalized flashcards, quiz questions, quiz attempts, learning progress, and document sections.
- `apps/api/src/routes/learning.ts`: add review summary, flashcard review state, quiz attempts/scoring, A2UI descriptor endpoint, and retrieval-aware Ask AI.
- `apps/api/src/routes/learning.test.ts`: cover review state, quiz scoring, and section retrieval.
- `apps/mobile/src/types.ts`: add learning/review response types.
- `apps/mobile/src/api/documents.ts`: add learning API client functions.
- `apps/mobile/app/(tabs)/study.tsx`: add real Review filters and learning progress dashboard.
- `apps/mobile/app/document/[id].tsx`: add Ask AI, flashcard review actions, quiz attempt flow, note/highlight delete/edit actions.
- `apps/extension/src/api/client.ts`: add send-to-study and learning API calls.
- `apps/extension/src/sidepanel/App.tsx`: expose Study actions without crowding quick actions.
- `docs/internal-testing.md` and `docs/release-blockers.md`: update deployment/store status with verified evidence.

---

### Task 1: Normalize Learning And Review State

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Add: `apps/api/prisma/migrations/20260527170000_learning_review_state/migration.sql`
- Modify: `apps/api/src/routes/learning.ts`
- Modify: `apps/api/src/routes/learning.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests in `apps/api/src/routes/learning.test.ts` for:

```text
GET /api/learning/:documentId/review returns notes, highlights, flashcards, quiz questions, quiz attempts, and learning progress.
PATCH /api/learning/:documentId/flashcards/:flashcardId/review stores known/needs_review state.
POST /api/learning/:documentId/quiz/attempts scores answers and persists the attempt.
POST /api/learning/:documentId/ask sends only the most relevant document sections to the generator.
```

Run:

```bash
npm run test -w apps/api -- learning.test.ts --reporter=verbose
```

Expected: tests fail because the routes and repository methods do not exist.

- [ ] **Step 2: Add Prisma models**

Add models:

```prisma
model LearningFlashcard {
  id           String   @id @default(cuid())
  userId       String
  documentId   String
  question     String
  answer       String
  topicTag     String?
  difficulty   String   @default("medium")
  reviewStatus String   @default("new")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deletedAt    DateTime?

  document ReadingDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([userId, documentId, deletedAt])
  @@index([userId, reviewStatus])
}

model LearningQuizQuestion {
  id            String   @id @default(cuid())
  userId        String
  documentId    String
  question      String
  questionType  String
  options       String   @default("[]")
  correctAnswer String
  explanation   String
  topicTag      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  document ReadingDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([userId, documentId, deletedAt])
}

model LearningQuizAttempt {
  id          String   @id @default(cuid())
  userId      String
  documentId  String
  answers     String
  score       Int
  total       Int
  createdAt   DateTime @default(now())

  document ReadingDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([userId, documentId, createdAt])
}
```

- [ ] **Step 3: Persist generated learning to normalized tables**

When summary, flashcards, or quiz is generated, keep updating the existing document fields and upsert normalized learning rows for review state.

- [ ] **Step 4: Add review routes**

Implement:

```text
GET /api/learning/:documentId/review
PATCH /api/learning/:documentId/flashcards/:flashcardId/review
POST /api/learning/:documentId/quiz/attempts
GET /api/learning/review
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run test -w apps/api -- learning.test.ts --reporter=verbose
npm run typecheck -w apps/api
```

---

### Task 2: Add Retrieval-Aware Ask AI

**Files:**
- Modify: `apps/api/src/routes/learning.ts`
- Modify: `apps/api/src/learning/gemini.ts`
- Modify: `apps/api/src/routes/learning.test.ts`

- [ ] **Step 1: Add section ranking tests**

Create a long document fixture with unrelated sections and one relevant section. Ask a question whose answer is in the relevant section. Assert the generator receives the title plus the relevant section and excludes unrelated sections.

- [ ] **Step 2: Implement deterministic section ranking**

Split document blocks into sections, score each section by lowercased keyword overlap with the question, keep the top six sections, and include adjacent title/heading blocks when present.

- [ ] **Step 3: Add cited section metadata**

Return cited section snippets from Gemini and preserve the selected section text in tests.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test -w apps/api -- learning.test.ts --reporter=verbose
```

---

### Task 3: Add Mobile Review And Study Workflows

**Files:**
- Modify: `apps/mobile/src/types.ts`
- Modify: `apps/mobile/src/api/documents.ts`
- Modify: `apps/mobile/app/(tabs)/study.tsx`
- Modify: `apps/mobile/app/document/[id].tsx`

- [ ] **Step 1: Add typed learning API functions**

Add functions for:

```text
getLearningReview(documentId)
getGlobalLearningReview()
markFlashcardReview(documentId, flashcardId, reviewStatus)
submitQuizAttempt(documentId, answers)
askDocumentQuestion(documentId, question)
```

- [ ] **Step 2: Add Study Review filters**

The Study tab must show Today, This week, Needs review, Completed, Low quiz score, By topic, By source, and By content type using backend review data.

- [ ] **Step 3: Add document learning actions**

Document detail must support Ask AI, flashcard known/needs review, quiz answer selection, quiz score, retry, and suggested review sections.

- [ ] **Step 4: Verify**

Run:

```bash
npm run typecheck -w apps/mobile
```

---

### Task 4: Add Trusted A2UI-Compatible Study Descriptors

**Files:**
- Modify: `apps/api/src/learning/schema.ts`
- Modify: `apps/api/src/routes/learning.ts`
- Modify: `apps/api/src/routes/learning.test.ts`

- [ ] **Step 1: Define approved component schema**

Add a Zod schema for approved component descriptors only:

```text
SummaryCard
KeyPointsList
QuizQuestionCard
FlashcardDeck
StudyPlanCard
ReviewProgressCard
HighlightCard
NoteInput
ActionButton
```

- [ ] **Step 2: Add endpoint**

Expose:

```text
GET /api/learning/:documentId/ui
```

The endpoint returns only trusted descriptor JSON derived from stored learning data. It must not accept arbitrary component names from Gemini.

- [ ] **Step 3: Verify**

Run:

```bash
npm run test -w apps/api -- learning.test.ts --reporter=verbose
```

---

### Task 5: Complete Chrome Learning Entry Points

**Files:**
- Modify: `apps/extension/src/api/client.ts`
- Modify: `apps/extension/src/shared/types.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/api/client.test.ts`

- [ ] **Step 1: Add learning API client tests**

Test that the extension can trigger summary generation, fetch review state, and send a document to Study without storing Gemini keys client-side.

- [ ] **Step 2: Add compact Study action**

Add one `Study` action to Now Reading and recent history cards. Keep deeper review management in mobile.

- [ ] **Step 3: Verify**

Run:

```bash
npm run test -w apps/extension -- --reporter=verbose
npm run typecheck -w apps/extension
npm run build -w apps/extension
```

---

### Task 6: Submit Internal App Builds

**Files:**
- Modify: `docs/internal-testing.md`
- Modify: `docs/release-blockers.md`

- [ ] **Step 1: Build latest store artifacts**

Run:

```bash
cd apps/mobile
npm run build:internal:android
npm run build:internal:ios
```

- [ ] **Step 2: Submit Android to internal track**

Run:

```bash
cd apps/mobile
npx eas-cli@latest submit -p android --profile internal --latest --wait
```

- [ ] **Step 3: Submit iOS to TestFlight**

Run:

```bash
cd apps/mobile
npx eas-cli@latest submit -p ios --profile internal --latest --wait --what-to-test "ReadMate AI internal build with synced library, RSS/PDF support, Google TTS, Gemini study tools, notes, highlights, flashcards, quizzes, and Ask AI."
```

- [ ] **Step 4: Update status docs**

Record build IDs, submission status, processing status, and any store-console blockers.

---

### Task 7: Final Deployment And E2E Verification

**Files:**
- Modify: `.gcloudignore`
- Modify: `docs/release-blockers.md`

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm run test -w apps/api -- --reporter=verbose
npm run test -w apps/extension -- --reporter=verbose
npm run typecheck -w apps/api
npm run typecheck -w apps/mobile
npm run typecheck -w apps/extension
npm run build -w apps/extension
```

- [ ] **Step 2: Deploy API to Cloud Run**

Run Cloud Build and deploy the latest image to `readmate-api` in `us-central1`.

- [ ] **Step 3: Run authenticated production smoke**

Verify save selection, URL save, RSS save, PDF upload if a fixture is available, progress sync, notes, highlights, summary, flashcards, quiz attempt, Ask AI, review, settings, clear history, and delete.

- [ ] **Step 4: Confirm app install path**

Confirm the latest Android/iOS internal build can be installed by at least one internal tester account.

---

## Spec Coverage

- Sections 1-15 are completed by the foundation plus Tasks 5-7.
- Sections 16-24 are completed by Tasks 1-4.
- Section 25 is completed by the deployed Gemini backend and Tasks 1-2.
- Section 26 is completed by Task 4.
- Sections 27-32 are completed by backend routes, tests, and production smoke in Task 7.
- Sections 33-34 are complete only after Task 7 and internal app installation verification pass.
