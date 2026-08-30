# Product Requirements and Technical Review Document

Review date: 2026-06-15  
Codebase: `/Users/danielnortey/Documents/readaloud`  
Observed product name: ReadMate AI  
Review basis: source inspection, configuration review, existing docs, route inventory, Prisma schema review, and verification commands run on 2026-06-15.

## 1. Executive Summary

ReadMate AI is a cross-device reading, listening, and study product. The current implementation includes a Manifest V3 Chrome extension, an Expo React Native mobile app, and a Node/Express API backed by Prisma/PostgreSQL. Users can capture web pages, selected text, RSS items, and uploaded documents, save them to a synced library, listen through backend-generated text-to-speech, track reading progress, and generate learning material such as summaries, key points, flashcards, quizzes, notes, highlights, and Ask AI answers.

The main user groups appear to be students, researchers, knowledge workers, and readers who want to consume long-form content across desktop and mobile. Operational stakeholders include backend operators, mobile release owners, extension release owners, and anyone responsible for privacy, AI/TTS cost, and app-store compliance.

The implementation is beyond a simple prototype. It has real API routes, Clerk authentication, Prisma migrations, Supabase Storage integration, Google/Khaya/Gemini integrations, a mobile app with playback and study screens, a Chrome side panel, and meaningful unit/API tests. It is still not production-ready because important security controls, abuse controls, API documentation, usage metering, account data controls, mobile automated coverage, and dependency remediation are incomplete.

Key strengths:

| Strength | Evidence |
|---|---|
| Cross-device architecture is real | `apps/extension`, `apps/mobile`, and `apps/api` share the same document model and backend API |
| Provider secrets remain backend-side | TTS, Gemini, Khaya/GhanaNLP, Supabase service-role, and Google credentials are only used in `apps/api/src` |
| Authenticated user scoping is broadly applied | Most API routers are mounted behind Clerk middleware in `apps/api/src/app.ts` and query by `userId` |
| Data model covers core product areas | `apps/api/prisma/schema.prisma` includes documents, blocks, settings, uploads, sources, notes, highlights, flashcards, quiz questions, and attempts |
| Existing tests cover many critical paths | API route tests, extension client tests, content extraction tests, player tests, and mobile study filter tests exist |
| Mobile product surface is substantial | Expo Router screens cover home, library, sources, study, history, settings, document detail, and player |

Major risks and gaps:

| Risk or gap | Severity | Summary |
|---|---:|---|
| API tests fail | High | `npm test --workspaces --if-present` fails in two API contract areas: local-language learning translation and non-PDF upload validation |
| Dependency audit findings | High | `npm audit --omit=dev --audit-level=moderate` reports 32 vulnerabilities, including high-severity `esbuild` and `ws` advisories |
| URL/RSS ingestion SSRF risk | High | `/api/content/save-url` and RSS refresh fetch user-provided URLs without visible private-network or metadata-IP protections |
| Broad CORS fallback | High | API falls back to `cors({ origin: true })` if `EXTENSION_ORIGIN` is unset |
| Limited rate limiting | High | Only `/api/tts` has explicit rate limiting; uploads, content fetches, learning generation, cron, and writes do not |
| Raw error exposure | Medium | Global API error middleware returns raw exception messages to clients |
| Broad Chrome permissions | Medium | Extension requests `http://*/*`, `https://*/*`, `file://*/*`, `tabs`, and `cookies` |
| Missing business controls | High | No billing, quotas, usage metering, account deletion, export, or admin/support tooling found |

## 2. Product Overview

### Core Purpose

ReadMate AI converts content into a synced, listenable, and studyable library. The product captures content from Chrome and mobile, stores it as structured reading blocks, plays it as generated speech, and helps users review the material through AI-generated learning tools.

### Main User Journeys

| Journey | Current implementation evidence | Status |
|---|---|---|
| Sign in and sync across devices | Clerk in `apps/api/src/auth.ts`, `apps/mobile/app/_layout.tsx`, and extension Clerk bridge | Implemented |
| Read current page in Chrome | `apps/extension/src/content.ts`, `apps/extension/src/content/textExtraction.ts`, `apps/extension/src/sidepanel/App.tsx` | Implemented |
| Read selected text in Chrome | Context menu and command in `apps/extension/src/background.ts`; selected text extraction in content script | Implemented |
| Save webpage or selected text | `/api/content/save-url`, `/api/content/save-selection`, extension `createSyncedDocument`, mobile Sources screen | Implemented |
| Upload a document | Mobile `DocumentPicker`, extension upload, `/api/content/upload-pdf`, document extraction helpers | Implemented, with route naming mismatch |
| Listen with TTS | `/api/tts`, extension `requestTtsAudio`, mobile `createSpeechAudioFile`, mobile `PlaybackManagerProvider` | Implemented |
| Resume progress | `/api/documents/:id/progress`, extension progress sync, mobile playback progress sync | Implemented |
| Manage library | Mobile Library filters/sorting, document CRUD routes | Implemented |
| Subscribe to sources/RSS | `/api/sources`, RSS refresh job, mobile Sources screen | Implemented |
| Generate study material | `/api/learning/*`, Gemini generator, mobile Study/document detail, extension Learn tab | Implemented |
| Ask questions about a document | `/api/learning/:documentId/ask`, mobile document Ask mode, extension Ask action | Implemented |
| Add notes and highlights | `/api/notes`, `/api/highlights`, mobile document detail | Implemented |
| Manage settings | `/api/settings`, mobile Settings, extension synced settings | Implemented |
| Billing and plan enforcement | UI copy references ReadMate Plus, but no payment or quota system found | Missing |
| Account data export/deletion | No export/delete-all account flow found | Missing |
| Admin/support tools | No admin role, support console, or internal reporting UI found | Missing |

### Primary Business or Operational Goals

- Build a cross-device reading library that starts from Chrome and continues on mobile.
- Provide high-quality speech through backend-mediated TTS.
- Add study workflows that increase retention and product stickiness.
- Keep provider credentials and service-role storage access off client devices.
- Support internal mobile testing and extension distribution.
- Control AI/TTS cost and privacy risk before broader production launch.

### Key Product Modules

| Module | Scope |
|---|---|
| Chrome extension | Browser capture, side panel reading UI, local fallback history, highlighting, PDF upload, learning/history/settings panels |
| Mobile app | Authenticated app shell, library, source management, study dashboard, document detail, notes, highlights, playback, settings |
| API | Auth, TTS, document sync, content ingestion, uploads, sources, settings, learning, notes/highlights, RSS cron |
| Database | Reading document state, blocks, settings, sources, uploads, study state, notes, highlights |
| Storage | Private document uploads and public/cached media through Supabase Storage |
| AI/TTS integrations | Google TTS, Google Translate, Khaya/GhanaNLP, Gemini |

### Assumptions From Code

- Clerk `userId` is the durable user identity; no separate first-party `User` table exists.
- Supabase is likely used for Postgres and Storage, but all privileged access is server-side.
- Cloud Run is the current API deployment target based on `Dockerfile`, `cloudbuild.yaml`, and mobile EAS environment values.
- Vercel support remains in `apps/api/api/index.ts` and `apps/api/vercel.json`, but appears secondary or historical.
- The app is in internal-test or late-MVP stage, not mature public GA.

## 3. Technology Stack

| Area | Technology | Where used | Why it appears to be used | Risks or limitations |
|---|---|---|---|---|
| Monorepo | npm workspaces | Root `package.json` with `apps/*` | Coordinates API, extension, and mobile commands | `packages/*` workspace is declared but no shared package was found |
| Language | TypeScript | API, extension, mobile | Shared type safety and modern app code | Some serializers still use `any`; runtime validation is uneven |
| Backend | Node.js 20+, Express 4 | `apps/api/src` | HTTP API, middleware, route handlers | Async errors need disciplined handling; no structured error envelope |
| Auth | Clerk | `@clerk/express`, `@clerk/chrome-extension`, `@clerk/clerk-expo` | Shared identity across extension and mobile | Requires strict origin/redirect configuration; no role model found |
| Database ORM | Prisma 6 | `apps/api/prisma/schema.prisma`, API repositories | Typed Postgres access and migrations | Several enum-like fields are plain strings |
| Database | PostgreSQL | Prisma datasource `DATABASE_URL` | Synced library and study state | No direct RLS evidence because backend owns access |
| Storage | Supabase Storage | `apps/api/src/storage.ts`, uploads/media | Private uploads and cached cover media | Service-role access is powerful; lifecycle and scanning are not modeled |
| TTS | Google Cloud Text-to-Speech | `apps/api/src/routes/tts.ts` | Primary speech generation | Cost, quota, latency, and provider error leakage risks |
| Local-language support | Google Translate, Khaya/GhanaNLP | `apps/api/src/localLanguage.ts` | Twi/Ewe translation and synthesis | Current test failure shows fragility in this path |
| AI learning | Gemini | `apps/api/src/learning/gemini.ts`, `apps/api/src/routes/learning.ts` | Summaries, flashcards, quizzes, Ask AI | Needs rate limits, quotas, and async job strategy |
| Extension frontend | React 19, Vite, Manifest V3, lucide-react | `apps/extension` | Chrome side panel and popup UI | Broad permissions and large sidepanel component |
| Mobile frontend | Expo 56, React Native 0.85, Expo Router | `apps/mobile` | iOS/Android app and route-based screens | New stack versions need ongoing store/build validation |
| Mobile data fetching | TanStack React Query | `apps/mobile/src/hooks/use-reading-library.ts` | Server-state caching and mutations | Query invalidation is manual |
| Mobile audio | `expo-audio` | `apps/mobile/src/playback/playback-manager.tsx` | Playback, background audio, lock-screen metadata | Requires real-device testing for interruptions/background behavior |
| Extension state/storage | Chrome storage, local fallback state, Zustand dependency | `apps/extension/src` | Local settings/history and session fallback | Manual token fallback in extension storage is sensitive |
| Validation | Zod | API route schemas and learning schemas | Runtime request/response validation | Some routes allow Zod errors to hit global 500 handler |
| Testing | Vitest, Supertest, jsdom | API and extension tests, mobile filter test | Unit/API coverage | Mobile screens/playback lack meaningful automated coverage |
| Deployment | Docker, Cloud Build, Cloud Run | `Dockerfile`, `cloudbuild.yaml` | Containerized API deployment | Cloud Run is unauthenticated; app auth is enforced at API layer |
| Alternative API deploy | Vercel | `apps/api/api/index.ts`, `apps/api/vercel.json` | Serverless compatibility | Could drift from Cloud Run path |
| Mobile distribution | EAS | Root `eas.json`, `apps/mobile/eas.json` | Internal/store builds and submit profiles | Duplicate EAS configs; env values duplicated |

Dependency audit on 2026-06-15:

| Command | Result |
|---|---|
| `npm audit --omit=dev --audit-level=moderate` | Failed with 32 vulnerabilities: 23 moderate, 9 high |
| High-severity families | `esbuild <=0.28.0`, `ws 8.0.0 - 8.20.1` |
| Moderate families | `js-yaml <=4.1.1`, `uuid <11.1.1`, and transitive Expo/Clerk/Solana dependency paths |
| Remediation concern | Audit suggests force upgrades with breaking changes, so remediation should be planned and verified rather than applied blindly |

## 4. Codebase Structure

### Main Directories

| Directory | Purpose |
|---|---|
| `apps/api` | Express API, Prisma schema/migrations, TTS, learning, storage, content ingestion, RSS jobs |
| `apps/extension` | Chrome MV3 extension, background worker, content scripts, side panel, popup, player, PDF/text extraction |
| `apps/mobile` | Expo app routes, screens, components, API client, playback manager, study utilities |
| `docs` | Product plans, release notes, setup/deployment docs, store metadata, prior technical review |
| `scripts` | Cloud Run deployment and RSS refresh helper scripts |
| `build-logs` | Local build/export/submission logs |
| `screenshots` | Mobile screenshots and QA assets |

### Architecture Assessment

The high-level separation of concerns is workable:

- API, extension, and mobile are separated into workspace apps.
- API routers map closely to product domains: documents, content, uploads, settings, sources, learning, notes, highlights.
- Mobile routes follow Expo Router conventions under `apps/mobile/app`.
- Extension code separates background, content, sidepanel, shared messages/settings/types, and player logic.
- Prisma schema and migrations are centralized under `apps/api/prisma`.

Maintainability concerns:

| Concern | Location | Why it matters |
|---|---|---|
| Very large sidepanel component | `apps/extension/src/sidepanel/App.tsx` | Auth, playback, history, learning, uploads, settings, and UI state are mixed in one file |
| Large API route modules | `content.ts`, `documents.ts`, `learning.ts` | Route handling, repositories, serializers, and domain helpers are colocated, increasing change risk |
| Duplicate document/history API concepts | `/api/documents`, `/api/history`, `/api/library`, `/library` | More surface area to document, secure, and keep compatible |
| Duplicate EAS configuration | `eas.json`, `apps/mobile/eas.json` | Build settings can drift |
| Build artifacts in source tree | IPA/AAB/zip/log files at repo root and `build-logs` | Useful operationally, noisy for review and repository hygiene |
| Date-sensitive docs | `README.md`, `docs/*` | README still says native mobile TTS is next, while mobile playback is implemented |

### Environment Variables

| Area | Variables |
|---|---|
| API core | `PORT`, `DATABASE_URL`, `NODE_ENV` |
| Auth | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` |
| CORS | `EXTENSION_ORIGIN` |
| TTS/translation | `GOOGLE_TTS_API_KEY`, `GOOGLE_TRANSLATE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `KHAYA_API_KEY`, `KHAYA_SUBSCRIPTION_KEY`, `GHANANLP_API_KEY`, `GHANANLP_SUBSCRIPTION_KEY`, `KHAYA_TTS_URL`, `KHAYA_TTS_SPEAKER_ID`, `KHAYA_SUBSCRIPTION_HEADER` |
| Learning | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_MEDIA_BUCKET` |
| Jobs | `CRON_SECRET`, `ENABLE_RSS_REFRESH_WORKER`, `RSS_REFRESH_INTERVAL_MINUTES` |
| Extension | `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_ENABLE_CLERK_UI`, `VITE_CLERK_SYNC_HOST`, `VITE_READMATE_API_URL` |
| Mobile | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_READMATE_API_URL`, `EXPO_PUBLIC_SCREENSHOT_MODE` |

## 5. API Review

### Global Behavior

- App factory: `apps/api/src/app.ts`.
- Server entry: `apps/api/src/server.ts`.
- Public health route: `GET /health`.
- Most routes require Clerk if `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` are configured.
- `/api/tts` has `express-rate-limit` set to 30 requests per minute by Clerk user ID or IP.
- JSON body limit is `1mb`.
- Content/document upload uses custom multipart parsing in the content route.
- CORS defaults to `EXTENSION_ORIGIN?.split(",") ?? true`.
- Global error handler returns `{ error: message }`.

### Endpoint Inventory

| Route | Method | Purpose | Main input | Expected response | Auth | Status and issues |
|---|---:|---|---|---|---|---|
| `/health` | GET | Health check | None | `{ ok: true }` | No | Implemented |
| `/api/cron/rss-refresh` | POST | Refresh due RSS feeds | `x-cron-secret` or query `secret` | Refresh summary | Shared secret | Implemented; query secret should be removed |
| `/api/tts` | POST | Generate speech audio | text, provider, voice, speed, targetLanguage | Audio bytes | Clerk unless anonymous TTS enabled | Implemented; only endpoint group with rate limit |
| `/api/documents` | GET | List user documents | None | Document array | Clerk | Implemented |
| `/api/documents` | POST | Create document and blocks | title, sourceType, metadata, progress, blocks | Document | Clerk | Implemented |
| `/api/documents/:id` | GET | Get one document | id | Document | Clerk | Implemented |
| `/api/documents/:id` | PATCH | Update document metadata/study fields | partial metadata and learning fields | Document | Clerk | Implemented |
| `/api/documents/:id/progress` | PATCH | Save reading progress and voice/speed | progress, provider, voice, speed | Document | Clerk | Implemented |
| `/api/documents/:id` | DELETE | Soft-delete a document | id | 204 | Clerk | Implemented |
| `/api/documents/completed` | DELETE | Delete completed documents | None | `{ count }` | Clerk | Implemented |
| `/api/documents/history` | DELETE | Clear all reading history | None | `{ count }` | Clerk | Implemented |
| `/api/documents/:id/history` | DELETE | Clear one document history | id | Document | Clerk | Implemented |
| `/api/history` | GET/POST/PATCH/DELETE | Legacy history operations | document/progress payloads | Documents or 204 | Clerk | Implemented, likely legacy |
| `/api/library`, `/library` | various | Alias to document router | Same as documents | Same as documents | Clerk | Implemented alias |
| `/api/content/save-url` | POST | Fetch URL/RSS and save content | url, sourceType, title, voice, speed | document/source or documents/source | Clerk | Implemented; needs SSRF controls |
| `/api/content/save-selection` | POST | Save selected/captured text | title, text, source metadata | document | Clerk | Implemented |
| `/api/content/upload-pdf` | POST | Multipart document upload and extraction | file, title, voice, speed | document and upload record | Clerk | Implemented; route name is PDF-specific but supports broader documents |
| `/api/uploads/pdf/sign` | POST | Create signed upload URL | filename, mimeType, byteSize | upload record and signed URL | Clerk | Implemented; current test expects non-PDF rejection but implementation returns 201 |
| `/api/uploads/:id/download-url` | GET | Create signed download URL | upload id | signed URL | Clerk | Implemented |
| `/api/uploads/:id/pdf/document` | POST | Convert uploaded PDF to document | title, voice, speed | Document | Clerk | Implemented, PDF-specific |
| `/api/sources` | GET | List subscriptions | None | source array | Clerk | Implemented |
| `/api/sources/subscribe` | POST | Subscribe or re-subscribe | sourceName, websiteUrl/rssFeedUrl | source | Clerk | Implemented |
| `/api/sources/:id` | PATCH | Edit subscription | partial source fields | source | Clerk | Implemented |
| `/api/sources/:id` | DELETE | Unsubscribe | id | 204 | Clerk | Implemented |
| `/api/settings` | GET | Get/create settings | None | settings | Clerk | Implemented |
| `/api/settings` | PUT | Save settings | voice, speed, targetLanguage, etc. | settings | Clerk | Implemented |
| `/api/learning/review` | GET | Global study review | None | totals and document summaries | Clerk | Implemented |
| `/api/learning/:documentId/summary` | POST | Generate full learning payload | counts, targetLanguage | learning, document, fallback | Clerk | Implemented; one local-language test failing |
| `/api/learning/:documentId/flashcards` | POST | Generate flashcards | count, targetLanguage | flashcards, document, fallback | Clerk | Implemented |
| `/api/learning/:documentId/quiz` | POST | Generate quiz | count, targetLanguage | quiz, document, fallback | Clerk | Implemented |
| `/api/learning/:documentId/review` | GET | Document study review | document id | review payload | Clerk | Implemented |
| `/api/learning/:documentId/key-points` | GET | Key points | document id | string array | Clerk | Implemented |
| `/api/learning/:documentId/flashcards` | GET | Flashcards | document id | card array | Clerk | Implemented |
| `/api/learning/:documentId/quiz` | GET | Quiz questions | document id | quiz array | Clerk | Implemented |
| `/api/learning/:documentId/ui` | GET | Parsed study UI descriptor | document id | UI descriptor | Clerk | Implemented |
| `/api/learning/:documentId/flashcards/:flashcardId/review` | PATCH | Mark flashcard status | reviewStatus | flashcard | Clerk | Implemented |
| `/api/learning/:documentId/quiz/attempts` | POST | Submit quiz attempt | answers map | scored attempt | Clerk | Implemented |
| `/api/learning/:documentId/ask` | POST | Ask AI over document | question, targetLanguage | answer, citedSections, fallback | Clerk | Implemented |
| `/api/learning/:documentId` | DELETE | Clear learning data | document id | 204 | Clerk | Implemented |
| `/api/notes` | GET | List notes | optional `documentId` | note array | Clerk | Implemented |
| `/api/notes` | POST | Create note | documentId, noteText, optional position | note | Clerk | Implemented |
| `/api/notes/:noteId` | PATCH | Update note | noteText | note | Clerk | Implemented |
| `/api/notes/:noteId` | DELETE | Soft-delete note | note id | 204 | Clerk | Implemented |
| `/api/highlights` | GET | List highlights | optional `documentId` | highlight array | Clerk | Implemented |
| `/api/highlights` | POST | Create highlight | documentId, blockIndex, text, type | highlight | Clerk | Implemented |
| `/api/highlights/:highlightId` | DELETE | Soft-delete highlight | highlight id | 204 | Clerk | Implemented |

### API Review Findings

| Finding | Impact | Recommendation |
|---|---|---|
| Strong route-specific Zod validation exists in many routers | Good baseline for payload safety | Continue and centralize validation error handling |
| Some Zod errors are not consistently caught | Invalid payloads can become 500s | Add global Zod error middleware or wrapper |
| No formal OpenAPI/API reference found | Integration and regression risk | Generate OpenAPI from Zod or maintain `docs/api.md` |
| No request ID or structured logging visible | Harder production debugging | Add request IDs, structured logs, and sanitized error IDs |
| Duplicate/alias API surfaces exist | More maintenance and security work | Mark legacy routes, deprecate where possible |
| URL ingestion is synchronous | Slow third-party sites block requests | Move heavy fetching/extraction to background jobs |

## 6. Implemented Features

| Product area | Feature | Relevant files/APIs | Status | Limitations |
|---|---|---|---|---|
| Authentication | Clerk-backed sync auth | `apps/api/src/auth.ts`, mobile root layout, extension Clerk bridge | Implemented | No admin/role model; manual extension session fallback is sensitive |
| Chrome capture | Read page, selection, context menu, keyboard command | `background.ts`, `content.ts`, `textExtraction.ts` | Implemented | Sensitive domains/forms need stronger exclusion |
| Chrome playback | Side panel playback, highlighting, floating player | `sidepanel/App.tsx`, `playerMachine.ts`, `floatingPlayer.ts` | Implemented | Large sidepanel component and complex fallback paths |
| Synced library | Documents, blocks, progress, soft delete | `/api/documents`, mobile/extension clients | Implemented | JSON-string metadata and legacy aliases |
| Mobile app shell | Home, Library, Sources, History, Study, More, Settings, Document, Player | `apps/mobile/app` | Implemented | Screen-level tests are minimal |
| Mobile playback | Expo audio, segmenting, lock-screen metadata, background audio | `apps/mobile/src/playback/playback-manager.tsx`, mobile `app.json` | Implemented | Needs real-device regression suite |
| Content ingestion | Save URL, RSS, selected text | `/api/content/save-url`, `/api/content/save-selection` | Implemented | SSRF and timeout controls need hardening |
| Document upload | PDF/EPUB/DOCX/DOC extraction | `extractDocumentText.ts`, `/api/content/upload-pdf` | Implemented | Route names and tests still say PDF in places |
| Source management | Subscribe, edit, remove, RSS refresh | `/api/sources`, RSS jobs | Implemented | Job observability missing |
| Study tools | Summary, key points, flashcards, quiz, Ask AI | `/api/learning/*`, Gemini generator, mobile Study/detail, extension Learn | Implemented | Local-language learning test failing |
| Notes/highlights | Create/list/update/delete notes and highlights | `/api/notes`, `/api/highlights` | Implemented | Mobile path clearer than extension persistence path |
| Settings | Voice, speed, tone, target language, highlight mode, articles per feed | `/api/settings`, settings panels | Implemented | Provider normalized to Google only |
| Local-language speech | Twi/Ewe translation and speech path | `localLanguage.ts`, `ttsSchema.ts`, `/api/tts` | Partially implemented | Provider integration is fragile and test failure exists |
| Deployment | Docker, Cloud Build, Cloud Run, Vercel entrypoint | `Dockerfile`, `cloudbuild.yaml`, `apps/api/api/index.ts` | Implemented | Multiple deployment paths can drift |
| Release operations | EAS configs, store metadata, build logs | `eas.json`, `apps/mobile/eas.json`, `docs/store-metadata.md`, `build-logs` | Partially implemented | Duplicate configs and date-sensitive operational artifacts |

## 7. Product Requirements

| ID | Title | User story | Acceptance criteria | Priority | Current status | Related files/APIs |
|---|---|---|---|---|---|---|
| PRD-001 | User sign-in | As a user, I want to sign in so my library syncs across devices. | Mobile and extension can obtain Clerk tokens; API rejects unauthenticated synced routes. | High | Implemented | `auth.ts`, mobile `_layout.tsx`, extension Clerk bridge |
| PRD-002 | Anonymous Chrome reading | As a browser user, I want to read locally before creating an account. | Extension can read selected/page text and keep local fallback history without sync. | Medium | Implemented | `sidepanel/App.tsx`, Chrome storage |
| PRD-003 | Save webpage | As a signed-in user, I want to save a webpage for later reading. | URL is fetched, extracted, saved as blocks, and appears in the library. | High | Implemented | `/api/content/save-url`, `/api/documents` |
| PRD-004 | Save selected text | As a user, I want to save only selected text. | Selection creates a document with metadata and readable blocks. | High | Implemented | `/api/content/save-selection` |
| PRD-005 | Upload document | As a user, I want to upload PDF/EPUB/DOC/DOCX files. | Supported files upload, text extracts, unreadable files return clear errors. | High | Partially implemented | `/api/content/upload-pdf`, `extractDocumentText.ts`, `/api/uploads/*` |
| PRD-006 | Library browse/filter | As a mobile user, I want to organize saved content. | Library filters by status, type, source, category, and sort mode. | Medium | Implemented | mobile Library screen |
| PRD-007 | Resume progress | As a user, I want playback to resume where I stopped. | Block, sentence, character offset, and percent sync across devices. | High | Implemented | `/api/documents/:id/progress`, playback managers |
| PRD-008 | TTS playback | As a user, I want high-quality speech for content. | Valid text returns audio for configured voice, speed, and target language. | High | Implemented | `/api/tts`, Google TTS |
| PRD-009 | Local-language listening | As a Ghanaian/local-language learner, I want Twi/Ewe playback. | Supported target language translates and synthesizes reliably. | Medium | Partially implemented | `localLanguage.ts`, failing learning test |
| PRD-010 | Source/RSS subscriptions | As a user, I want feeds to import recent articles. | Users can subscribe, edit, remove, and refresh RSS sources. | Medium | Implemented | `/api/sources`, RSS jobs |
| PRD-011 | Study generation | As a learner, I want summaries, key points, flashcards, and quizzes. | Study material is generated, stored, reviewed, and visible across clients. | High | Implemented | `/api/learning/*` |
| PRD-012 | Ask AI | As a user, I want answers grounded in the document. | Question returns answer and cited sections, with fallback if provider is unavailable. | Medium | Implemented | `/api/learning/:id/ask` |
| PRD-013 | Notes/highlights | As a learner, I want to save notes and highlights. | User can create/list/update/delete notes and create/list/delete highlights scoped to document. | Medium | Implemented | `/api/notes`, `/api/highlights` |
| PRD-014 | Settings sync | As a user, I want voice and study preferences synced. | Settings persist and apply across mobile and extension. | High | Implemented | `/api/settings` |
| PRD-015 | Account deletion/export | As a privacy-conscious user, I want to export/delete my data. | User can request export and delete all account data. | High | Missing | No API/UI found |
| PRD-016 | Usage metering and quotas | As an operator, I want to control TTS and AI cost. | Usage is measured per user/provider and limits are enforced. | High | Missing | No usage model found |
| PRD-017 | Billing/subscription | As a business, I want paid plan enforcement. | Payment state controls usage limits and Plus features. | High | Missing/placeholder | Settings copy references Plus; no payment code |
| PRD-018 | Admin/support tooling | As support/admin, I want safe diagnostic visibility. | Authorized support users can inspect health, jobs, and user support metadata. | Medium | Missing | No admin area found |
| PRD-019 | API documentation | As a developer, I want clear API contracts. | OpenAPI or equivalent docs exist for all endpoints and payloads. | Medium | Missing | No OpenAPI file found |
| PRD-020 | Production security controls | As an operator, I want safe public exposure. | CORS, SSRF controls, rate limits, error sanitization, audit remediation, and logging are in place. | High | Partially implemented | `app.ts`, `content.ts`, dependency tree |

## 8. Gaps and Missing Features

| Gap | Impact | Severity | Recommended fix | Related files/modules |
|---|---|---:|---|---|
| API tests fail | Blocks production confidence | High | Fix local-language translation failure and align upload validation/product contract | `learning.test.ts`, `uploads.test.ts`, `localLanguage.ts`, `uploads.ts` |
| URL ingestion lacks visible SSRF controls | Backend could fetch private/internal resources | High | Block localhost/private/link-local/metadata IPs, validate DNS after redirects, add time/byte limits | `content.ts`, RSS jobs |
| CORS defaults open if env missing | Broader browser-origin exposure | High | Fail closed in production and require explicit origins | `app.ts` |
| Rate limiting only on TTS | AI, upload, crawler, cron, and write endpoints can be abused | High | Add per-user/IP route-group limits and quotas | `app.ts`, route middleware |
| Raw API error messages | Internal/provider details can leak | Medium | Sanitize client messages and log details server-side with request ID | `app.ts`, route catches |
| No usage/cost metering | AI/TTS cost cannot be controlled | High | Add `UsageEvent` or equivalent and enforce plan/quota limits | New models and middleware |
| No account deletion/export | Privacy and app-store compliance risk | High | Add data export/delete endpoints and Settings UI | API, mobile Settings |
| Billing is placeholder | "ReadMate Plus" cannot be enforced | High | Add payment provider, plan model, webhook handling, quota integration | Settings, backend |
| Upload route/test mismatch | Product contract unclear | Medium | Rename PDF-specific routes or update tests/docs to support broader documents | `uploads.ts`, `content.ts`, tests |
| Broad Chrome permissions | Higher store review and trust risk | Medium | Remove unused `cookies`, narrow host permissions, use optional host access where possible | `manifest.json` |
| Manual extension session token fallback | Token exposure risk | Medium | Restrict to dev, expire aggressively, prefer Clerk extension flow | `authClient.ts` |
| JSON strings for structured fields | Hard to query, constrain, and report | Medium | Use Prisma `Json`/JSONB or normalized tables | Prisma schema |
| Mobile screen coverage is thin | UI regressions likely rely on manual QA | Medium | Add mobile component tests and E2E smoke flows | `apps/mobile` |
| RSS job observability missing | Feed failures may go unnoticed | Medium | Add job run records, failure table, metrics, and alerts | RSS jobs |
| No formal API docs | Integration and maintenance friction | Medium | Generate OpenAPI or maintain a route contract document | `docs`, route schemas |
| Large frontend modules | Harder to maintain and test | Medium | Extract hooks/components/services by domain | `sidepanel/App.tsx`, API route files |

## 9. Security Review

| Security finding | Severity | Location | Risk explanation | Recommended remediation |
|---|---:|---|---|---|
| User-provided URL/RSS fetching lacks visible SSRF defenses | High | `apps/api/src/routes/content.ts`, RSS refresh jobs | Attackers may cause backend to call localhost, cloud metadata, private IPs, or large/slow resources | Add URL allow/deny checks, DNS/IP validation, private range blocklist, redirect limits, timeouts, and max bytes |
| CORS falls back to open origin behavior | High | `apps/api/src/app.ts` | If production env is misconfigured, unexpected origins can call API with valid bearer tokens | Require explicit production origin list and fail startup when missing |
| Rate limiting is incomplete | High | `apps/api/src/app.ts` | Expensive or sensitive routes can be abused, especially learning generation and content crawling | Apply rate limits and per-user quotas by route group |
| Dependency audit has high-severity findings | High | dependency tree | `esbuild` and `ws` advisories may affect dev server exposure or transitive runtime packages | Plan dependency upgrades, test Expo/Clerk/Vite compatibility, and pin remediated versions |
| Raw errors returned to clients | Medium | global error handler and route catches | Provider messages and internal configuration details can leak | Use generic client responses and structured internal logs |
| Chrome extension permissions are broad | Medium | `apps/extension/public/manifest.json` | `http://*/*`, `https://*/*`, `file://*/*`, `tabs`, and `cookies` increase blast radius | Remove unused permissions and move to optional permissions where feasible |
| Manual session token storage path | Medium | `apps/extension/src/auth/authClient.ts` | Bearer tokens in extension storage can be reused if exposed | Prefer Clerk token flow; restrict manual token to dev or add expiry/clearance |
| Cron secret accepted in query string | Medium | `/api/cron/rss-refresh` in `app.ts` | Query secrets can appear in logs, browser history, and proxies | Accept secret header only and rate-limit failed attempts |
| Upload signing contract is unclear | Medium | `apps/api/src/routes/uploads.ts` | Current implementation signs non-PDF uploads despite PDF route naming and failing test | Decide allowed types and enforce MIME/extension consistently |
| Service-role Supabase key used by backend | Medium | `apps/api/src/storage.ts` | Expected for backend storage, but compromise grants broad storage access | Keep server-only, rotate keys, restrict bucket policies and object namespaces |
| Missing account deletion/export | Medium/High | no implementation found | Users have no visible privacy self-service | Add account data lifecycle controls |
| Output encoding risk in injected extension UI | Low/Medium | extension content/floating player | React escapes most UI, but manually injected DOM must never interpolate user text unsafely | Continue using DOM APIs/textContent for dynamic data; avoid user-content `innerHTML` |
| Payment security not reviewed | N/A | no payment code found | No payment implementation exists | Re-review when billing is added |

Security positives:

- Most persistent data routes are Clerk-protected and scoped by `userId`.
- Prisma reduces SQL injection risk through parameterized ORM calls.
- Provider API keys and storage service-role credentials are not used directly from mobile or extension clients.
- Upload/download URLs are created server-side for authenticated users.
- Several payload size limits and Zod validations are already present.

## 10. Code Quality Review

### Strengths

| Area | Observation |
|---|---|
| Type safety | TypeScript is used across all workspaces |
| Runtime validation | Zod schemas cover many API inputs and learning outputs |
| Testability | API routers accept dependency injection for repositories/storage/generators in several files |
| Client state | Mobile uses React Query for server state, cache invalidation, and optimistic settings updates |
| Product logic | Playback, learning, source management, and document sync are implemented as real workflows |
| Fallback behavior | Learning and extension sync include fallback paths for provider/API failures |

### Concerns

| Concern | Example | Recommendation |
|---|---|---|
| Very large components/modules | `apps/extension/src/sidepanel/App.tsx`; API `content.ts`, `documents.ts`, `learning.ts` | Split by domain into hooks, services, repositories, serializers, and smaller components |
| Inconsistent error handling | Some routes catch Zod errors; others rely on global 500 handler | Add route wrapper or global typed error middleware |
| `any` in serializers | API serializers in route modules | Replace with Prisma model types or narrow DTO types |
| Duplicated route semantics | `/api/history` and `/api/documents` progress/history operations | Deprecate legacy routes or document compatibility purpose |
| Stale documentation | README says native mobile TTS is next, but mobile playback exists | Refresh README and launch docs |
| UI accessibility inconsistency | Some mobile controls use raw symbols rather than icons/labels | Use accessible icon components and labels consistently |
| Source hygiene | Build artifacts and many generated packages are present in repo root | Move release artifacts to ignored storage or documented artifact folder |

### Accessibility and Responsiveness

- Mobile screens use meaningful text, touch targets, and some accessibility labels.
- Playback controls have some labels, but icon/symbol consistency should improve.
- Extension side panel is dense and should receive keyboard and screen-reader review.
- Mobile uses FlatList batching for large library lists.
- Several style definitions use fixed inline layout values; continued device-size QA is needed.

## 11. Database and Data Model Review

### Main Models

| Model | Purpose | Relationships |
|---|---|---|
| `ReadingDocument` | Saved content metadata, status, progress, playback settings, summary fields | Has blocks, sessions, notes, highlights, flashcards, quiz questions, quiz attempts |
| `ReadingBlock` | Ordered text blocks for playback and reading | Belongs to document; unique by `documentId` and `orderIndex` |
| `ReadingSession` | Listening session history | Belongs to document |
| `UserSettings` | Per-user provider, voice, speed, language, source preferences | Unique by `userId` |
| `UploadedFile` | Upload metadata and storage key | Stores optional `documentId`, but no explicit Prisma relation |
| `SourceSubscription` | Website/RSS subscription state | Scoped by user |
| `Note` | Notes attached to documents or highlights | Belongs to document; optional highlight |
| `Highlight` | Highlighted text and position | Belongs to document; has notes |
| `LearningFlashcard` | Persisted generated flashcards | Belongs to document |
| `LearningQuizQuestion` | Persisted generated quiz questions | Belongs to document |
| `LearningQuizAttempt` | User quiz attempt and scoring | Belongs to document |

### Schema Strengths

- User-scoped indexes exist for document listing, last-read, deletion status, document status, notes/highlights, sources, and learning records.
- `ReadingBlock` ordering is constrained by a unique index per document.
- Soft delete exists for documents, notes, highlights, flashcards, and quiz questions.
- Document dedupe uses a unique user/dedupe key.
- Cascade deletes are configured for many document-owned records.

### Schema Issues

| Issue | Impact | Recommendation |
|---|---|---|
| No first-party user/account model | Harder account lifecycle, billing, support, export/delete | Add `UserAccount`/`UserProfile` if billing/privacy/admin features are planned |
| Enum-like fields are strings | Invalid DB values possible outside API | Use Prisma enums or DB check constraints |
| Structured arrays are JSON strings | Hard to query/report/filter and enforce schema | Use Prisma `Json` fields or normalized tables |
| `UploadedFile.documentId` lacks relation | Data integrity weaker | Add explicit relation to `ReadingDocument` |
| Upload lifecycle not modeled | Storage cleanup and retention unclear | Add `deletedAt`, `processedAt`, `status`, bucket, and cleanup job |
| No usage/cost table | Cannot meter or limit AI/TTS usage | Add `UsageEvent` or `MeteredUsage` |
| No job/failure table | RSS and learning jobs hard to observe | Add `JobRun`, `RssRefreshRun`, or provider failure records |
| Learning summary duplicated in document and normalized tables | Potential drift | Decide canonical source and sync rules |

## 12. Testing Review

Verification commands run on 2026-06-15:

| Command | Result |
|---|---|
| `npm run typecheck --workspaces --if-present` | Passed for API, extension, and mobile |
| `npm test --workspaces --if-present` | Failed because API workspace has 2 failing tests; extension tests passed |
| `npm audit --omit=dev --audit-level=moderate` | Failed with 32 vulnerabilities: 23 moderate, 9 high |

Test result details:

| Workspace | Result |
|---|---|
| API | 8 files passed, 2 failed; 59 tests passed, 2 failed |
| Extension | 11 files passed; 48 tests passed |
| Mobile | No `test` script in `apps/mobile/package.json`; one mobile utility test file exists but is not run through workspace test script |
| Typecheck | API, extension, and mobile all passed |

Failing tests:

| Test | Failure | Likely implication |
|---|---|---|
| `src/routes/learning.test.ts > translates generated study material through GhanaNLP for supported local languages` | Expected 200, got 500 | Local-language learning translation/synthesis mock or implementation regressed |
| `src/routes/uploads.test.ts > rejects non-PDF uploads` | Expected 400, got 201 | Implementation accepts non-PDF upload signing while test expects PDF-only contract |

Current coverage by feature:

| Feature | Tested? | Notes |
|---|---|---|
| TTS route and schema | Yes | API tests cover Google credentials, translation, local-language paths, validation |
| Documents CRUD/progress/history | Yes | `documents.test.ts` exists |
| Content save URL/selection/upload | Yes | `content.test.ts` exists |
| Upload signing and PDF conversion | Yes, with one failing contract test | Needs product decision |
| Settings | Yes | `settings.test.ts` exists |
| Notes/highlights | Yes | `notes.test.ts`, `highlights.test.ts` exist |
| Learning generation/review/Ask AI | Yes, with one failing local-language test | Good breadth but fragile provider path |
| Extension API client | Yes | `client.test.ts` has broad sync client coverage |
| Extension player/text extraction/messages | Yes | Multiple unit tests exist |
| Mobile study filters | Yes as file, not executed by mobile workspace script | Add mobile test script |
| Mobile screens/playback | No meaningful automated evidence found | Needs component/E2E testing |
| Security controls | Limited | Missing SSRF, CORS, auth boundary, and route-limit tests |

Recommended tests:

- Add SSRF tests for localhost, private IPs, metadata IPs, DNS rebinding-style redirects, oversized responses, and slow endpoints.
- Add route-group rate-limit tests for learning, uploads, content ingestion, cron, and document writes.
- Add mobile test script and component tests for Library, Sources upload, Document detail, PlaybackBar, and Settings.
- Add E2E smoke test for Chrome capture to backend save to mobile resume.
- Add OpenAPI contract tests once API docs exist.
- Add background audio/manual device regression checklist for iOS and Android.

## 13. Performance Review

### Current Performance Positives

| Positive | Evidence |
|---|---|
| Document/history/list routes are bounded | Several repository list calls use `take` limits |
| TTS text is split to provider limits | `apps/api/src/routes/tts.ts` splits Google TTS text by byte limit |
| Mobile library uses list virtualization | Library and History use `FlatList` with batching/windowing |
| Mobile server state is cached | React Query is configured with stale time and query cache |
| Cloud Run scaling is bounded | `cloudbuild.yaml` sets max instances to 3 |
| Gemini overload fallback exists | Learning route logs fallback for temporary high-demand errors |

### Performance Risks

| Risk | Location | Impact | Recommendation |
|---|---|---|---|
| TTS audio regenerated repeatedly | `/api/tts`, mobile and extension playback | Latency, cost, quota usage | Cache audio by text hash, voice, speed, language, and provider |
| Sequential TTS part synthesis | `apps/api/src/routes/tts.ts` | Long text waits on serial provider calls | Consider bounded concurrency and prefetching |
| URL/RSS extraction inline | `apps/api/src/routes/content.ts`, RSS jobs | Slow third-party responses block API requests | Move ingestion to background jobs with status polling |
| Gemini generation inline | `apps/api/src/routes/learning.ts` | Provider latency blocks user requests | Add async generation jobs and client progress states |
| Document extraction inline | `/api/content/upload-pdf`, `/api/uploads/:id/pdf/document` | Large files can tie up request workers | Use background processing for larger files |
| No usage metering | API-wide | Cannot identify high-cost users/routes | Add usage metrics and quotas |
| JSON strings for queryable data | Prisma schema | Filtering/reporting requires parsing in app code | Migrate to JSONB or normalized tables |
| Large extension sidepanel | `sidepanel/App.tsx` and extension bundle | Slower load and harder UI performance tuning | Split code by tab/feature and lazy-load learning/history panels |
| No API response caching strategy | API | Repeated settings/library/review reads hit DB | Add safe per-user ETags or cache headers where appropriate |

## 14. Recommendations and Roadmap

### Immediate Fixes

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Fix the two failing API tests or deliberately update the product/test contract | P0 | S/M | High | Backend | `learning`, `uploads` |
| Add SSRF protections for URL/RSS ingestion | P0 | M | High | Backend/security | `content.ts`, RSS jobs |
| Make CORS fail closed in production | P0 | S | High | Backend | `app.ts` |
| Add sanitized error handling with request IDs | P0 | S/M | High | Backend | API middleware |
| Add rate limits for learning, upload, content ingestion, cron, and writes | P0 | M | High | Backend | `app.ts` |
| Plan dependency remediation for 32 audit findings | P0 | M/L | High | Platform | package dependency tree |

### Short-Term Improvements

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Decide upload product contract and rename PDF-specific routes if broader documents stay supported | P1 | S/M | Medium | Backend/mobile | upload/content routes |
| Produce API reference or OpenAPI docs from current routes | P1 | M | High | Backend | docs/API |
| Remove or justify broad extension permissions, especially `cookies` | P1 | S | Medium | Extension | `manifest.json` |
| Add mobile test script and initial screen/component tests | P1 | M | Medium | Mobile | `apps/mobile` |
| Add usage metering for TTS, Gemini, translation, uploads, and RSS | P1 | M | High | Backend/product | new models |
| Refresh README and release docs to match current mobile playback/study state | P2 | S | Medium | Product/engineering | docs |
| Consolidate duplicate EAS config | P2 | S | Medium | Mobile/release | `eas.json`, `apps/mobile/eas.json` |

### Medium-Term Improvements

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Move long-running ingestion and learning generation to background jobs | P2 | L | High | Backend | jobs/queues |
| Add audio caching and prefetching | P2 | M/L | High | Backend/mobile | TTS/media |
| Migrate JSON strings to JSONB or normalized tables | P2 | L | Medium | Backend/data | Prisma |
| Add account deletion/export | P2 | M | High | Backend/mobile | settings/account |
| Add RSS refresh observability and failure records | P2 | M | Medium | Backend/ops | RSS jobs |
| Split large sidepanel and API route modules | P2 | M/L | Medium | Extension/backend | `sidepanel/App.tsx`, route files |
| Add E2E smoke flow for Chrome-to-mobile sync | P2 | L | High | QA/engineering | all clients |

### Long-Term Improvements

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Add billing/subscription enforcement | P3 | L | High | Product/backend | billing |
| Add admin/support console with strict authorization | P3 | L | Medium | Ops/backend | admin |
| Add offline reading and cached audio | P3 | L | Medium/High | Mobile/backend | mobile/media |
| Add native share extensions | P3 | L | Medium | Mobile | iOS/Android |
| Add product analytics and cost dashboards | P3 | M/L | High | Product/data | analytics |
| Add provider abstraction for future TTS/AI vendors | P3 | M | Medium | Backend | TTS/learning |

## 15. Final Summary

ReadMate AI is a substantial late-MVP or internal-test product. The core product loop is implemented: capture content in Chrome or mobile, save it to a synced backend, listen through TTS, resume progress across devices, and use AI-powered study tools. The codebase has a reasonable workspace split, real persistence, production-oriented deployment files, and meaningful tests.

The product should not be treated as fully production-ready yet. The biggest blockers are failing API tests, dependency audit vulnerabilities, URL ingestion security, open CORS fallback, incomplete rate limiting, raw error exposure, missing usage metering, missing account data lifecycle controls, and limited mobile automated coverage.

Highest-priority technical risks:

1. Fix the two failing API tests or update contracts intentionally.
2. Harden `/api/content/save-url` and RSS fetching against SSRF and slow/large responses.
3. Fail closed on production CORS and sanitize API error responses.
4. Add rate limits and quotas beyond TTS.
5. Remediate or explicitly risk-accept the current audit findings with an upgrade plan.

Highest-priority product gaps:

1. Account deletion/export and privacy self-service.
2. Usage metering, quotas, and billing/plan enforcement.
3. Formal API documentation.
4. Mobile test coverage and end-to-end sync validation.
5. Clear upload contract for PDF versus broader document formats.

Suggested next step: treat this review as a launch-hardening backlog. The first engineering pass should focus on security controls, test failures, and dependency posture before adding more product surface area.
