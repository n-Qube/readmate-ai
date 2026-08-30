# Product Requirements and Technical Review Document

Review date: 2026-06-11  
Codebase: `/Users/danielnortey/Documents/readaloud`  
Product name observed in code/docs: ReadMate AI

## 1. Executive Summary

ReadMate AI is a cross-device reading and listening product. The current implementation includes a Manifest V3 Chrome extension, an Expo React Native mobile app, and a Node/Express API. The product lets users capture web pages, selections, RSS items, and uploaded documents, save them to a synced library, listen with server-side text-to-speech, track reading progress, and generate study material such as summaries, key points, flashcards, quizzes, notes, highlights, and Ask AI answers.

The likely primary user groups are students, professionals, researchers, and readers who want to listen to long-form content across desktop and mobile. Operational stakeholders include app-store release owners, backend operators, and anyone responsible for cloud costs, user privacy, and AI provider reliability.

The implementation is beyond an MVP scaffold. It has real API routes, Prisma migrations, Clerk authentication, Supabase Storage integration, production deployment files, internal testing docs, mobile build metadata, and substantial unit/API tests. It is not yet fully production-ready because there are current failing API tests, broad Chrome permissions, partial rate limiting, raw error exposure, SSRF-style URL ingestion risk, no formal API documentation, and dependency audit findings.

Key strengths:

- Clear monorepo separation across `apps/api`, `apps/extension`, and `apps/mobile`.
- Backend-first architecture keeps TTS, Gemini, Google, Khaya/GhanaNLP, Supabase service-role, and database credentials server-side.
- Authenticated API routes consistently scope most data by Clerk `userId`.
- Prisma schema and migrations cover library, blocks, settings, uploads, sources, notes, highlights, and learning review state.
- Extension and mobile share the same backend document model.
- Existing tests cover many API routes and extension behaviors.

Major risks and gaps:

- `npm test --workspaces --if-present` currently fails in the API workspace: 2 failed tests, 59 passed API tests; extension tests pass.
- `npm audit --omit=dev` reports 27 moderate vulnerabilities, mainly through `vite/esbuild`, `uuid`, Expo, and Clerk transitive dependency chains.
- `/api/content/save-url` and RSS ingestion fetch arbitrary user-supplied URLs without visible private-network or metadata-IP protections.
- CORS defaults to `origin: true` if `EXTENSION_ORIGIN` is not configured.
- API error middleware returns raw exception messages to clients.
- Chrome extension requests broad `host_permissions` and `cookies` permission.
- Rate limiting is applied to `/api/tts` only, not uploads, content ingestion, learning generation, cron brute force attempts, or document writes.
- Several arrays and structured fields are stored as JSON strings, which limits queryability and constraints.

## 2. Product Overview

### Core Purpose

ReadMate AI is a reading companion that converts saved web and document content into listenable and studyable material. It aims to make desktop-captured content available on mobile, preserve progress, and add AI-powered learning workflows.

### Main User Journeys

| Journey | Current implementation evidence | Status |
|---|---|---|
| Read current web page in Chrome | `apps/extension/src/content.ts`, `apps/extension/src/content/textExtraction.ts`, `apps/extension/src/sidepanel/App.tsx` | Implemented |
| Read selected text in Chrome | Context menu and command in `apps/extension/src/background.ts`; selection extraction in content script | Implemented |
| Save page/selection to synced library | `createSyncedDocument`, `/api/content/save-url`, `/api/content/save-selection`, `/api/documents` | Implemented with fallback |
| Listen with TTS | Extension `requestTtsAudio`, mobile `createSpeechAudioFile`, backend `/api/tts` | Implemented |
| Continue reading on mobile | Mobile `useReadingLibrary`, `PlaybackBar`, `PlaybackManagerProvider`, `/api/documents/:id/progress` | Implemented |
| Upload documents | Mobile DocumentPicker and backend `/api/content/upload-pdf`; upload signing routes under `/api/uploads` | Implemented, naming remains PDF-centric |
| Subscribe to RSS/source | Mobile Sources tab, `SourceSubscription`, RSS refresh worker/cron | Implemented |
| Generate learning material | `/api/learning/*`, Gemini generator, mobile Study tab and document detail tools | Implemented |
| Notes/highlights | `/api/notes`, `/api/highlights`, mobile document detail | Implemented |
| Account and settings | Clerk, `/api/settings`, mobile Settings, extension settings sync | Implemented |
| Billing/subscriptions | Mobile text shows "ReadMate Plus"; no payment code found | Missing/placeholder |
| Admin/reporting | No admin app or analytics reporting surface found | Missing |

### Primary Business or Operational Goals

- Provide a cross-device reading library.
- Convert saved content to speech without exposing provider secrets to clients.
- Keep users engaged through progress, study, and review workflows.
- Support app-store/internal testing and Chrome extension distribution.
- Run a production API on Cloud Run with bounded scaling.

### Key Product Areas

- Content capture: web pages, selections, RSS, PDFs, EPUB, DOC/DOCX.
- Library and progress sync.
- Audio playback and lock-screen/background playback on mobile.
- AI learning: summary, key points, flashcards, quizzes, Ask AI.
- Source management and RSS refresh.
- Settings: voice, speed, target language, tone, highlight mode, articles per feed.
- Authentication and account state through Clerk.

### Assumptions

- Clerk `userId` is the durable user identity; there is no separate internal `User` model in Prisma.
- Supabase Postgres is used through Prisma, while Supabase Storage is accessed with a service-role key from the backend.
- Production API target is Cloud Run based on `cloudbuild.yaml`, `Dockerfile`, and `docs/release-blockers.md`.
- The product is in internal testing or late MVP stage, not public-scale GA.

## 3. Technology Stack

| Area | Technology | Where used | Why it appears to be used | Risks or limitations |
|---|---|---|---|---|
| Monorepo/package manager | npm workspaces | Root `package.json` | Coordinates API, extension, mobile workspaces | No shared package folder currently visible despite `packages/*` workspace entry |
| Language | TypeScript | All app workspaces | Type safety across backend/client | Some repositories use `any` in serializers; runtime validation is uneven |
| Backend runtime | Node.js 20+, Express 4 | `apps/api/src` | Simple API server and middleware stack | Express 4 requires explicit async error handling discipline |
| Auth | Clerk | `@clerk/express`, `@clerk/chrome-extension`, `@clerk/clerk-expo` | Cross-surface identity/session tokens | Depends on correct origin/redirect config; no role/admin model visible |
| Database ORM | Prisma 6 | `apps/api/prisma/schema.prisma`, route repositories | Typed database access and migrations | JSON stored as strings; many enum-like fields are unconstrained strings |
| Database | PostgreSQL, likely Supabase Postgres | `DATABASE_URL`, Prisma datasource | Durable synced library and study state | No RLS visible because clients route through backend; direct DB access must remain server-only |
| File storage | Supabase Storage | `apps/api/src/storage.ts`, uploads/media | Private uploaded files and cached media | Service-role access is powerful; bucket policy and file lifecycle not documented in code |
| TTS provider | Google Cloud Text-to-Speech | `apps/api/src/routes/tts.ts` | Main speech synthesis provider | Cost/rate risks; raw provider error messages can leak details |
| Local-language path | Google Translate + Khaya/GhanaNLP | `apps/api/src/localLanguage.ts` | Twi/Ewe translation and synthesis | Current API test failure in local-language learning path |
| AI study provider | Gemini | `apps/api/src/learning/gemini.ts`, `apps/api/src/routes/learning.ts` | Summaries, flashcards, quiz, Ask AI | Provider overload fallback exists, but cost/rate limiting is missing |
| Chrome extension | Manifest V3, Vite, React | `apps/extension` | Browser capture and side panel UI | Very broad host permissions and `cookies` permission |
| Mobile app | Expo, React Native, Expo Router | `apps/mobile` | iOS/Android app with native playback and storage | Uses newer Expo/React/React Native versions; store builds need ongoing verification |
| Mobile data fetching | TanStack React Query | `apps/mobile/src/hooks/use-reading-library.ts` | Caching and mutations | Query invalidation is manually maintained |
| Extension state | Zustand, Chrome storage | `apps/extension` | Local settings/history/session fallback | Manual session token stored in `chrome.storage.local` is sensitive |
| Validation | Zod | API schemas and learning schemas | Runtime payload validation | Error handling is inconsistent; some routes let Zod errors become 500 |
| Testing | Vitest, Supertest, jsdom | `*.test.ts` | API route and extension behavior tests | Mobile has minimal visible test coverage |
| Deployment | Docker, Cloud Build, Cloud Run, Vercel entrypoint | `Dockerfile`, `cloudbuild.yaml`, `apps/api/api/index.ts`, `apps/api/vercel.json` | Flexible backend deployment | Docs mention Cloud Run as current target; Vercel path may be stale |
| Mobile distribution | EAS | `eas.json`, `apps/mobile/eas.json` | App Store/TestFlight/Play internal builds | Public Clerk publishable keys are embedded, which is expected; production profile lacks explicit API env |

Dependency audit result on 2026-06-11:

- `npm audit --omit=dev` reported 27 moderate vulnerabilities.
- Main reported advisories: `esbuild <=0.24.2`, `vite <=6.4.1`, and `uuid <11.1.1` through Expo/Clerk/Solana transitive chains.
- Audit suggested breaking-force upgrades (`vite@8.0.16` and `expo@46.0.21` in the current npm output), so remediation should be planned and tested rather than applied blindly.

## 4. Codebase Structure

### Main Directories

| Directory | Purpose |
|---|---|
| `apps/api` | Express API, Prisma schema/migrations, route repositories, TTS, learning, storage, RSS jobs |
| `apps/extension` | Chrome MV3 extension with side panel, popup, background service worker, content scripts, PDF/text extraction, player logic |
| `apps/mobile` | Expo app with routes, screens, components, API client, playback manager, study filters |
| `docs` | Product plans, release blockers, setup/deployment notes, store metadata |
| `scripts` | Cloud Run deployment and RSS scheduler helper scripts |
| `build-logs` | Build and submission logs; should remain excluded from production packages |
| `screenshots/readmate-mobile` | Mobile screenshots for QA/store/design review |

### Architecture Assessment

Separation of concerns is generally good:

- API route files own request validation and repository operations.
- Prisma schema is centralized in `apps/api/prisma/schema.prisma`.
- Extension separates background, content, sidepanel, shared message/types/settings, PDF extraction, and player machine code.
- Mobile separates app routes, API client, hooks, components, playback, types, and utilities.

Maintainability concerns:

- Several API route files are large and combine route handlers, repository classes, serializers, and helper logic. `documents.ts`, `content.ts`, `learning.ts`, and `sidepanel/App.tsx` would benefit from extraction.
- `apps/extension/src/sidepanel/App.tsx` is a very large component with many responsibilities: auth bridge, history, playback, learning, settings, uploads, and UI state.
- The API has both `/api/documents` and older `/api/history`, plus aliases `/api/library` and `/library`. This increases surface area and documentation burden.
- `apps/mobile/eas.json` and root `eas.json` duplicate similar build configuration.
- `dist`, build artifacts, IPA/AAB files, and zip bundles are present in the workspace. They are useful operational artifacts but can make source review noisy.

Environment usage:

- Root `.env.example` documents backend, extension, and mobile variables.
- API expects `DATABASE_URL`, Clerk keys, Supabase keys, Google/Gemini/Khaya keys, CORS origins, cron secret, and worker settings.
- Mobile uses `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_READMATE_API_URL`, and screenshot mode.
- Extension uses Vite/Clerk/API environment settings plus Chrome storage defaults.

Scalability assessment:

- The current structure can support continued MVP iteration.
- For production scale, the biggest structural needs are service extraction for content ingestion/learning/TTS, formal API docs, background job infrastructure, and stricter security middleware.

## 5. API Review

### Global API Behavior

- App entry: `apps/api/src/app.ts`.
- Public health route: `GET /health`.
- Most app routes are Clerk-protected if `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` are set.
- `/api/tts` has per-user/IP rate limiting: 30 requests per minute.
- Request JSON body limit is `1mb` globally. Multipart upload parsing is custom for document upload.
- CORS uses `EXTENSION_ORIGIN?.split(",") ?? true`; if unset, all origins are effectively reflected/allowed.
- Raw errors are returned by final middleware as `{ error: message }`.

### Endpoint Inventory

| Route | Method | Purpose | Main input | Response | Auth | Status and issues |
|---|---:|---|---|---|---|---|
| `/health` | GET | Health check | None | `{ ok: true }` | No | Implemented |
| `/api/cron/rss-refresh` | POST | Refresh due RSS feeds | `x-cron-secret` header or `?secret=` | Refresh summary | Cron secret | Implemented; should rate-limit and avoid query secret logging |
| `/api/tts` | POST | Generate speech audio | text, voice, speed, targetLanguage | Audio bytes | Required unless `ALLOW_ANONYMOUS_TTS=true` | Implemented; only route with rate limit |
| `/api/documents` | GET | List user documents | None | Document array | Clerk | Implemented; takes 100 |
| `/api/documents` | POST | Create document with blocks | title, sourceType, metadata, blocks, progress | Document | Clerk | Implemented; strong Zod validation |
| `/api/documents/:id` | GET | Get one document | id path | Document | Clerk | Implemented |
| `/api/documents/:id` | PATCH | Update document metadata/learning fields | partial fields | Document | Clerk | Implemented |
| `/api/documents/:id/progress` | PATCH | Save progress and playback settings | progress, voice, speed | Document | Clerk | Implemented |
| `/api/documents/:id` | DELETE | Soft-delete document | id path | 204 | Clerk | Implemented |
| `/api/documents/completed` | DELETE | Delete completed docs | None | `{ count }` | Clerk | Implemented |
| `/api/documents/history` | DELETE | Clear reading history | None | `{ count }` | Clerk | Implemented |
| `/api/documents/:id/history` | DELETE | Clear one document's history | id path | Document | Clerk | Implemented |
| `/api/history` | GET/POST/PATCH/DELETE | Legacy history API | document/progress payloads | Documents/204 | Clerk | Implemented, probably legacy |
| `/api/library`, `/library` | all document routes | Alias to documents router | same as documents | same | Clerk | Implemented alias |
| `/api/content/save-url` | POST | Fetch URL/RSS and save document/source | url, sourceType, voice, speed | document/source or documents/source | Clerk | Implemented; SSRF/private-network controls not visible |
| `/api/content/save-selection` | POST | Save captured selected text | title, text, source metadata | document | Clerk | Implemented |
| `/api/content/upload-pdf` | POST | Multipart upload and extract document text | file, title, voice, speed | document + upload | Clerk | Implemented; supports more than PDFs despite route name |
| `/api/uploads/pdf/sign` | POST | Create signed upload URL | filename, mimeType, byteSize | upload record + signed URL | Clerk | Implemented; current test expects non-PDF rejection but implementation allows it |
| `/api/uploads/:id/download-url` | GET | Create signed download URL | upload id | signed URL | Clerk | Implemented |
| `/api/uploads/:id/pdf/document` | POST | Convert uploaded PDF to document | title, voice, speed | document | Clerk | Implemented; PDF-specific |
| `/api/sources` | GET | List subscribed sources | None | source array | Clerk | Implemented |
| `/api/sources/subscribe` | POST | Subscribe or re-subscribe source | sourceName, websiteUrl/rssFeedUrl | source | Clerk | Implemented |
| `/api/sources/:id` | PATCH | Edit source | partial source fields | source | Clerk | Implemented |
| `/api/sources/:id` | DELETE | Unsubscribe source | id path | 204 | Clerk | Implemented |
| `/api/settings` | GET | Get/create settings | None | settings | Clerk | Implemented |
| `/api/settings` | PUT | Save settings | voice, speed, targetLanguage, etc. | settings | Clerk | Implemented |
| `/api/learning/review` | GET | Global study review | None | totals and document review summaries | Clerk | Implemented |
| `/api/learning/:documentId/summary` | POST | Generate full learning payload | counts, targetLanguage | learning + updated document | Clerk | Implemented; one local-language test failing |
| `/api/learning/:documentId/flashcards` | POST | Generate flashcards | count, targetLanguage | flashcards + document | Clerk | Implemented |
| `/api/learning/:documentId/quiz` | POST | Generate quiz | count, targetLanguage | quiz + document | Clerk | Implemented |
| `/api/learning/:documentId/review` | GET | Document learning review | id path | summary/key points/cards/quiz/attempts | Clerk | Implemented |
| `/api/learning/:documentId/key-points` | GET | Key points | id path | string array | Clerk | Implemented |
| `/api/learning/:documentId/flashcards` | GET | Flashcards | id path | card array | Clerk | Implemented |
| `/api/learning/:documentId/quiz` | GET | Quiz questions | id path | quiz array | Clerk | Implemented |
| `/api/learning/:documentId/ui` | GET | Trusted study UI descriptors | id path | parsed UI descriptor | Clerk | Implemented |
| `/api/learning/:documentId/flashcards/:flashcardId/review` | PATCH | Mark flashcard review state | reviewStatus | flashcard | Clerk | Implemented |
| `/api/learning/:documentId/quiz/attempts` | POST | Submit quiz attempt | answer map | scored attempt | Clerk | Implemented |
| `/api/learning/:documentId/ask` | POST | Ask AI over document | question, targetLanguage | answer + citations + fallback | Clerk | Implemented |
| `/api/learning/:documentId` | DELETE | Clear learning data | id path | 204 | Clerk | Implemented |
| `/api/notes` | GET | List notes | optional documentId query | note array | Clerk | Implemented |
| `/api/notes` | POST | Create note | documentId, noteText, optional highlight/block | note | Clerk | Implemented |
| `/api/notes/:noteId` | PATCH | Update note text | noteText | note | Clerk | Implemented |
| `/api/notes/:noteId` | DELETE | Soft-delete note | note id | 204 | Clerk | Implemented |
| `/api/highlights` | GET | List highlights | optional documentId query | highlight array | Clerk | Implemented |
| `/api/highlights` | POST | Create highlight | documentId, block index/text/type | highlight | Clerk | Implemented |
| `/api/highlights/:highlightId` | DELETE | Soft-delete highlight | id path | 204 | Clerk | Implemented |

### API Security and Validation Gaps

- Missing formal OpenAPI or generated API docs.
- Route-level Zod validation is strong in many files, but some Zod errors can escape to the global 500 handler.
- No global request ID, structured logging, or sanitized error envelope.
- No visible abuse controls for learning generation, upload signing, document creation, content crawling, or RSS refresh.
- Content ingestion needs URL allow/deny logic and private IP protection.

## 6. Implemented Features

| Product area | Feature | Relevant files | Status | Limitations |
|---|---|---|---|---|
| Authentication | Clerk auth for API, extension, mobile | `auth.ts`, extension Clerk bridge, mobile root layout | Implemented | No roles/admin model; manual extension session-token fallback is sensitive |
| Chrome capture | Read page/selection/context menu/shortcut | `background.ts`, `content.ts`, `textExtraction.ts` | Implemented | Broad host permissions; sensitive pages/forms need stronger exclusion |
| Chrome playback | Side panel audio, highlighting, floating player | `sidepanel/App.tsx`, `playerMachine.ts`, `floatingPlayer.ts` | Implemented | Large component; fallback browser speech and remote TTS split complexity |
| Synced library | Document CRUD and block persistence | `/api/documents`, mobile/extension clients | Implemented | JSON-string fields; legacy aliases add complexity |
| Mobile app shell | Tabs for Home, Library, Sources, Study, More | `apps/mobile/app/(tabs)` | Implemented | Limited automated mobile tests |
| Mobile playback | Expo audio, lock-screen metadata, background audio | `playback-manager.tsx`, `app.json` | Implemented | Needs real-device regression testing for background and lock-screen behavior |
| PDF/document upload | Multipart upload/extraction and signed upload flow | `content.ts`, `uploads.ts`, mobile Sources | Implemented | Route names remain PDF-specific while product accepts more file types |
| RSS/source management | Subscribe, edit, remove, refresh worker/cron | `sources.ts`, `refreshRssFeeds.ts`, `rssRefreshWorker.ts` | Implemented | Needs production job observability and dedupe monitoring |
| Learning/study | Gemini summaries, key points, flashcards, quizzes, Ask AI | `learning.ts`, mobile Study/document detail, extension Quick Study | Implemented | One local-language learning test failing |
| Notes/highlights | Notes and highlights APIs and mobile document detail | `notes.ts`, `highlights.ts`, mobile document screen | Implemented | Extension highlight save path appears lighter than mobile |
| Settings | Voice, speed, tone, target language, content preferences | `settings.ts`, mobile Settings, extension shared settings | Implemented | Provider normalized to Google; UI should avoid suggesting unsupported providers |
| Local-language audio | Twi/Ewe translation and Khaya synthesis | `localLanguage.ts`, TTS schema | Implemented | Provider credentials and response formats are fragile; failing test indicates regression |
| Deployment | Docker/Cloud Build/Cloud Run, Vercel entry | `Dockerfile`, `cloudbuild.yaml`, `api/index.ts` | Implemented | Multiple deployment paths need a single source of truth |
| Release ops | Store metadata, internal testing docs, build logs | `docs/release-blockers.md`, `docs/internal-testing.md` | Partially implemented | Some docs are date-sensitive and may be stale |

## 7. Product Requirements

| ID | Title | User story | Acceptance criteria | Priority | Current status | Related files/APIs |
|---|---|---|---|---|---|---|
| PRD-001 | User sign-in | As a user, I want to sign in so my library syncs across devices. | Clerk login works on mobile and extension; API rejects unauthenticated synced routes. | High | Implemented | `auth.ts`, mobile `_layout.tsx`, extension auth |
| PRD-002 | Anonymous Chrome reading | As an anonymous user, I want to read locally without creating an account. | Extension can read selected/page text and keep local history without sync. | Medium | Implemented | extension sidepanel local history |
| PRD-003 | Save webpage | As a signed-in user, I want to save a webpage so I can read/listen later. | URL is fetched/extracted, saved as document blocks, and appears in library. | High | Implemented | `/api/content/save-url`, `/api/documents` |
| PRD-004 | Save selected text | As a user, I want to save selected text so I can listen to only the relevant part. | Selection creates a document with readable blocks and metadata. | High | Implemented | `/api/content/save-selection` |
| PRD-005 | Upload document | As a user, I want to upload PDF/EPUB/DOC/DOCX so it becomes listenable. | File is uploaded, text extracted, document created, errors shown if unreadable. | High | Partially implemented | `/api/content/upload-pdf`, `/api/uploads/*` |
| PRD-006 | Library browse/filter | As a mobile user, I want to browse and organize saved content. | Library filters by status, source, type, category, and sort mode. | Medium | Implemented | mobile Library screen |
| PRD-007 | Resume progress | As a user, I want to continue from where I stopped. | Progress saves block/sentence/percent and reloads across devices. | High | Implemented | `/api/documents/:id/progress`, playback manager |
| PRD-008 | TTS playback | As a user, I want high-quality speech for saved content. | TTS audio returns for validated text, voice, speed, language. | High | Implemented | `/api/tts`, Google TTS |
| PRD-009 | Local-language listening | As a Ghanaian/local-language learner, I want Twi/Ewe playback. | English content translates and synthesizes in supported local languages. | Medium | Partially implemented | `localLanguage.ts`, failing learning test |
| PRD-010 | Source/RSS subscriptions | As a user, I want feeds to import recent articles automatically. | Users can subscribe, edit, remove, and refresh RSS sources. | Medium | Implemented | `/api/sources`, RSS jobs |
| PRD-011 | Study generation | As a learner, I want summaries, flashcards, quizzes, and key points. | Study material is generated, stored, reviewed, and visible on mobile/extension. | High | Implemented | `/api/learning/*` |
| PRD-012 | Ask AI | As a user, I want to ask questions about a saved document. | Question returns answer and cited sections, with fallback if Gemini unavailable. | Medium | Implemented | `/api/learning/:id/ask` |
| PRD-013 | Notes and highlights | As a learner, I want to record notes/highlights. | User can create/list/delete notes and highlights scoped to document. | Medium | Implemented | `/api/notes`, `/api/highlights` |
| PRD-014 | Settings sync | As a user, I want preferences shared across devices. | Voice, speed, tone, language, highlight mode, source preferences sync. | High | Implemented | `/api/settings` |
| PRD-015 | Account deletion/data export | As a privacy-conscious user, I want account/data controls. | User can delete/export all data. | High | Missing | No API/admin flow found |
| PRD-016 | Usage/billing | As an operator, I want usage controls and payment gating. | TTS/AI usage tracked and plan limits enforced. | High | Missing/placeholder | Settings shows Plus; no payment backend |
| PRD-017 | Admin/support tooling | As support/admin, I want to inspect issues safely. | Admin can view system health, job status, and user support metadata. | Medium | Missing | No admin area found |
| PRD-018 | API documentation | As a developer, I want documented API contracts. | OpenAPI or equivalent docs exist for all endpoints. | Medium | Missing | No OpenAPI file found |

## 8. Gaps and Missing Features

| Gap | Impact | Severity | Recommended fix | Related files/modules |
|---|---|---:|---|---|
| API tests currently fail | Blocks confidence for production deploys | High | Fix local-language learning translation failure and align upload tests/product behavior | `learning.test.ts`, `uploads.test.ts`, `localLanguage.ts`, `uploads.ts` |
| SSRF/private-network protection missing for URL ingestion | Attackers could make backend fetch internal resources or cloud metadata | High | Add URL validation, DNS/IP checks, private range blocklist, redirect limits, size/time limits | `apps/api/src/routes/content.ts`, RSS jobs |
| CORS default allows broad origins | Browser clients from unexpected origins can call API if they have tokens | High | Require explicit origins in production; fail closed when `EXTENSION_ORIGIN` missing | `apps/api/src/app.ts` |
| Rate limiting only protects TTS | AI, uploads, crawling, cron, and writes can be abused | High | Add per-user/IP rate limits and quotas by route group | `apps/api/src/app.ts` |
| Raw errors returned to clients | Provider/secrets/config details can leak | Medium | Use sanitized error responses and server-side structured logs | `apps/api/src/app.ts`, route catch blocks |
| Broad Chrome permissions | Higher store-review and user-trust risk | Medium | Remove `cookies` if not essential; narrow host permissions or request optional host access | `apps/extension/public/manifest.json` |
| Manual extension session-token storage | Token theft impact if extension storage compromised | Medium | Prefer Clerk extension flow only; encrypt/expire manual token or limit to dev builds | `apps/extension/src/auth/authClient.ts` |
| Upload route/test mismatch | Product contract unclear for non-PDF docs | Medium | Rename routes to `/documents/upload` or update tests and docs to accept PDF/EPUB/DOCX | `uploads.ts`, `content.ts`, tests |
| JSON strings for structured data | Hard to query/filter/report and validate | Medium | Use JSONB fields or normalized tables for tags, key points, quiz, flashcards | Prisma schema |
| No usage metering | TTS/Gemini costs can grow without limits | High | Add usage events, quota checks, billing state, and dashboards | API middleware, new models |
| No account deletion/export | Privacy and app-store compliance risk | High | Add user data export/delete endpoints and UI | API, mobile settings |
| Weak API documentation | Slows integration and increases regression risk | Medium | Generate OpenAPI from Zod or maintain docs/API reference | `docs`, API schemas |
| Mobile automated coverage limited | Mobile regressions likely require manual detection | Medium | Add React Native component/unit tests and E2E smoke flows | `apps/mobile` |
| RSS job observability missing | Feed failures/dedup regressions may go unnoticed | Medium | Add job logs, metrics, failure table, dashboard/alerts | `refreshRssFeeds.ts` |
| Large extension sidepanel component | Hard to maintain and test feature changes | Medium | Split playback, history, learning, settings, auth into hooks/components | `sidepanel/App.tsx` |
| No admin/support workflows | Hard to debug user issues safely | Low/Medium | Add internal read-only support tools with strict authorization | New admin module |

## 9. Security Review

| Finding | Severity | Location | Risk explanation | Recommended remediation |
|---|---:|---|---|---|
| User-supplied URL fetching lacks visible SSRF controls | High | `apps/api/src/routes/content.ts`, RSS jobs | Backend fetches arbitrary URLs for page/RSS ingestion. Without private IP and redirect safeguards, attackers may reach internal services. | Validate protocol, resolve DNS, block private/link-local/metadata ranges, enforce redirect and byte limits, add fetch timeout. |
| CORS falls back to `true` | High | `apps/api/src/app.ts` | If `EXTENSION_ORIGIN` is unset, browser-origin restrictions are broad. | Fail closed in production and require configured extension/mobile web origins. |
| Rate limiting limited to TTS | High | `apps/api/src/app.ts` | Learning generation, uploads, save-url crawling, and document writes remain abuse-prone. | Add per-route-group rate limits and user quotas. |
| Raw exception messages returned | Medium | `apps/api/src/app.ts`, route catches | Provider errors, config details, or internal messages can leak. | Return generic client errors with internal log correlation IDs. |
| Chrome extension has broad host permissions and `cookies` | Medium | `apps/extension/public/manifest.json` | Increases blast radius, store-review scrutiny, and user concern. | Remove unused permissions; use `activeTab` and optional permissions where possible. |
| Manual Clerk token fallback stored locally | Medium | `apps/extension/src/auth/authClient.ts` | Stored bearer token could be reused if exposed. | Restrict to dev/test, prefer Clerk SDK token retrieval, set explicit expiry, clear on failures. |
| Cron secret can be passed in query string | Medium | `/api/cron/rss-refresh` in `app.ts` | Query secrets can appear in logs/proxies/history. | Accept secret header only; rate-limit failed attempts. |
| Upload signing accepts arbitrary MIME by current implementation | Medium | `apps/api/src/routes/uploads.ts` | Signed upload could store unexpected content if route remains broadly permissive. | Decide accepted types, validate MIME and extension, scan or process only expected formats. |
| Dependency audit reports 27 moderate vulnerabilities | Medium | `package-lock.json` dependency tree | Known advisories include dev server exposure and transitive uuid bounds issue. | Plan dependency upgrades and verify Expo/Clerk compatibility. |
| Service role key used in backend | Medium | `apps/api/src/storage.ts` | Required for backend storage, but compromise grants broad Supabase access. | Keep server-only, rotate periodically, use least-privileged storage policies where possible. |
| No CSRF protection | Low/Medium | API global | Bearer token APIs are less CSRF-prone, but broad CORS plus cookies/Clerk interactions need review. | Keep Authorization header auth, strict CORS, avoid cookie-authenticated unsafe routes unless CSRF protected. |
| Output encoding/XSS risk in extension | Low/Medium | `floatingPlayer.ts`, sidepanel UI | React escapes most UI, but manual `innerHTML` in injected floating player should stay static only. | Avoid interpolating user content into `innerHTML`; use DOM APIs for dynamic text. |
| No payment security path | N/A | No payment code found | Payment not implemented. | Add Stripe/payment review when billing is introduced. |

Security positives:

- Most data routes use Clerk middleware and `userId` scoping.
- Prisma parameterization reduces SQL injection risk.
- TTS and AI provider secrets stay backend-side.
- Supabase upload/download URLs are generated by authenticated backend routes.
- Text and payload sizes are bounded in Zod schemas in many areas.

## 10. Code Quality Review

### Strengths

- TypeScript is used across the API, extension, and mobile app.
- Zod schemas provide runtime validation for many API payloads.
- Repository-like interfaces in routes make API tests easier.
- Tests use Supertest and fake repositories/storage/generators effectively.
- Mobile uses React Query for server state and optimistic settings updates.
- API normalizes legacy provider choices to Google, reducing invalid state.
- Learning fallback logic handles Gemini overload instead of hard blocking users.

### Concerns

- Large files combine too many responsibilities:
  - `apps/extension/src/sidepanel/App.tsx`
  - `apps/api/src/routes/content.ts`
  - `apps/api/src/routes/documents.ts`
  - `apps/api/src/routes/learning.ts`
- Some route catches handle Zod errors, while others rely on global error middleware and may convert validation issues into 500s.
- `historyRouter` overlaps with `documentsRouter`, creating duplicate semantics.
- Serializers use `any` in several places.
- Data model uses JSON strings for arrays/objects rather than database JSON types or normalized tables.
- Mobile UI uses some literal symbols/text glyphs instead of icon components in player/source tiles.
- Docs are useful but date-sensitive; `README.md` has statements that appear older than the current implementation, such as native mobile TTS being "next" while mobile playback is now present.

### Accessibility and Responsiveness

- Mobile uses accessible labels on some controls, such as player close and transport controls.
- Several UI surfaces use selectable text and fixed touch heights.
- Some controls use textual symbols (circle-style glyphs, square glyphs, and arrows) rather than standard icons, which can reduce accessibility clarity.
- Extension side panel needs continued keyboard navigation and screen-reader review because it is a dense custom UI.

## 11. Database and Data Model Review

### Main Entities

| Model | Purpose | Key relationships |
|---|---|---|
| `ReadingDocument` | Saved content, metadata, progress, settings snapshot, learning summary fields | Has many blocks, sessions, notes, highlights, flashcards, quiz questions, quiz attempts |
| `ReadingBlock` | Ordered text blocks for playback/reading | Belongs to document; unique by document/orderIndex |
| `ReadingSession` | Listening session history | Belongs to document |
| `UserSettings` | Per-user voice/speed/content preferences | Unique by `userId` |
| `UploadedFile` | Stored upload metadata | Has `documentId` field but no Prisma relation |
| `SourceSubscription` | Website/RSS subscription state | Scoped by user |
| `Note` | User note attached to document/highlight | Belongs to document; optional highlight |
| `Highlight` | Highlighted text in a document | Belongs to document; has notes |
| `LearningFlashcard` | Generated or persisted flashcard | Belongs to document |
| `LearningQuizQuestion` | Generated quiz question | Belongs to document |
| `LearningQuizAttempt` | User quiz attempt and scoring | Belongs to document |

### Schema Strengths

- User scoping indexes exist on important tables.
- `ReadingBlock` has ordered uniqueness per document.
- Soft delete exists for documents, notes, highlights, flashcards, and quiz questions.
- Document dedupe key is unique per user.
- Cascade deletes are configured for many document-owned records.

### Schema Issues

- No `User` table despite older docs recommending one. Clerk `userId` is stored directly.
- Enum-like fields are strings (`sourceType`, `status`, provider, voice, category, review status), so invalid DB values are possible outside API validation.
- Structured fields are JSON strings: `topicTags`, `keyPoints`, `quizQuestions`, `flashcards`, `preferredContentTypes`, `topics`, `options`, `answers`, `results`.
- `UploadedFile.documentId` lacks an explicit Prisma relation to `ReadingDocument`.
- `UploadedFile` has no `deletedAt`, retention/lifecycle status, or storage bucket field in schema, although API responses include bucket name.
- No usage/cost model for TTS, AI, uploads, or RSS.
- No job/failure model for RSS refresh.
- No account deletion/export audit state.

### Recommended Data Model Improvements

- Migrate JSON strings to `Json` fields or normalized tables where filtering/reporting matters.
- Add database enums or check constraints for stable fields.
- Add a `UserAccount` or `UserProfile` model if account-level deletion/export/billing/admin support is planned.
- Add `UsageEvent` with user, provider, operation, units, cost estimate, and request metadata.
- Add `RssRefreshRun`/`RssRefreshItem` for observability.
- Add `deletedAt` or lifecycle state to `UploadedFile`.
- Add explicit relation from `UploadedFile.documentId` to `ReadingDocument`.

## 12. Testing Review

Verification commands run on 2026-06-11:

| Command | Result |
|---|---|
| `npm run typecheck --workspaces --if-present` | Passed for API, extension, and mobile |
| `npm test --workspaces --if-present` | Failed because API workspace has 2 failing tests |
| `npm audit --omit=dev` | Failed with 27 moderate vulnerabilities |

Additional verification note: the API typecheck regenerates Prisma Client successfully with Prisma `6.19.3`; the CLI reports a major Prisma `7.8.0` update is available, but that should be treated as a separate planned upgrade.

Test details:

- API: 8 test files passed, 2 failed; 59 passed tests, 2 failed tests.
- Extension: 11 test files passed; 48 passed tests.
- Mobile: no test script is visible in `apps/mobile/package.json`; typecheck passed.

Failing tests:

| Test | Failure | Likely implication |
|---|---|---|
| `src/routes/learning.test.ts > translates generated study material through GhanaNLP for supported local languages` | Expected 200, got 500 | Local-language learning translation path regressed or test mocks no longer match implementation |
| `src/routes/uploads.test.ts > rejects non-PDF uploads` | Expected 400, got 201 | Implementation now accepts broader file types or validation weakened; product contract needs alignment |

Current coverage by feature:

| Feature | Tested? | Notes |
|---|---|---|
| TTS schema and TTS route | Yes | API tests cover Google/key/local-language paths |
| Documents CRUD/progress | Yes | API route tests exist |
| Content save URL/selection/upload | Yes | API route tests exist |
| Upload signing | Yes, failing contract test | Needs fix/decision |
| Settings | Yes | API tests exist |
| Notes/highlights | Yes | API tests exist |
| Learning | Yes, one failing test | Good coverage of fallback and review behavior |
| Extension sync client | Yes | 22 client tests plus UI utility tests |
| Extension text extraction/player/messages | Yes | Unit tests exist |
| Mobile screens/playback | Minimal/No | Typecheck only found in current scripts |
| E2E cross-device flow | No automated evidence found | Needs manual or automated smoke tests |
| Security tests | Limited | Missing SSRF, auth boundary fuzzing, rate-limit tests beyond TTS |

Recommended tests:

- Add SSRF tests for blocked private IPs, localhost, metadata IPs, redirects, and oversized responses.
- Add route-level rate-limit tests for learning, uploads, save-url, and cron.
- Add mobile component tests for Library, Sources upload, Document detail, and PlaybackBar.
- Add a Playwright or Detox smoke test for sign-in, save URL, play, progress sync, generate study material.
- Add OpenAPI contract tests once API docs exist.
- Add migration tests or seed smoke tests for Prisma schema changes.

## 13. Performance Review

### Current Performance Positives

- Document listing is capped (`take: 100`), history and notes/highlights have limits.
- TTS text is split to stay under Google limits.
- Mobile FlatList uses batching/windowing for library rendering.
- React Query caches mobile API data.
- Gemini fallback avoids total feature failure on provider overload.
- Cloud Run max instances is bounded at 3 in `cloudbuild.yaml`.

### Performance Risks

| Risk | Location | Impact | Recommendation |
|---|---|---|---|
| TTS audio regenerated repeatedly | `/api/tts`, playback managers | Cost, latency, provider quota usage | Cache generated audio by text hash, voice, speed, target language |
| Sequential TTS part synthesis | `tts.ts` | Long content may wait on serial provider calls | Consider bounded concurrency and audio stitching strategy |
| URL/RSS extraction happens inline | `content.ts`, RSS jobs | Slow requests block API responses | Move heavy ingestion to background jobs with status states |
| Gemini generation happens inline | `learning.ts` | User waits; provider delays affect API | Add async job/status model for long study generation |
| Uploaded document extraction inline | `content/upload-pdf`, uploads routes | Large files can tie up request workers | Use background processing and progress states for larger docs |
| No global response caching | API | Repeated library/settings/learning calls hit DB | Add ETags or cache headers where safe; keep per-user privacy |
| Large extension bundle warning in docs | `docs/release-blockers.md` | Extension load/performance concern | Split sidepanel chunks and audit Clerk bundle impact |
| JSON string fields | Prisma schema | Query/filter overhead and client parsing | Use JSONB/normalized fields for searchable data |
| No usage metering | API | Cannot identify high-cost users/routes | Add metrics and per-provider usage events |

## 14. Recommendations and Roadmap

### Immediate Fixes

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Fix the 2 failing API tests or intentionally update product/test contracts | P0 | S/M | High | Backend | `learning`, `uploads` |
| Add SSRF protections to URL/RSS ingestion | P0 | M | High | Backend/security | `content.ts`, RSS jobs |
| Make CORS fail closed in production | P0 | S | High | Backend | `app.ts` |
| Add sanitized error handling | P0 | S/M | High | Backend | global middleware |
| Add rate limits/quotas for learning, upload, content ingestion, cron | P0 | M | High | Backend | `app.ts` |
| Decide document-upload contract and rename PDF-specific routes if needed | P1 | S/M | Medium | Backend/mobile | uploads/content |

### Short-Term Improvements

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Produce OpenAPI/API reference from current routes | P1 | M | High | Backend | docs/API |
| Remove or justify broad Chrome permissions, especially `cookies` | P1 | S | Medium | Extension | manifest |
| Add mobile test script and initial component tests | P1 | M | Medium | Mobile | `apps/mobile` |
| Split `sidepanel/App.tsx` into hooks/components | P1 | M/L | Medium | Extension | sidepanel |
| Add usage metering for TTS and Gemini | P1 | M | High | Backend/product | new models |
| Reconcile stale README statements with current mobile playback implementation | P2 | S | Medium | Product/engineering | docs |

### Medium-Term Improvements

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Move long content ingestion and learning generation to background jobs | P2 | L | High | Backend | jobs/queues |
| Add audio caching by text/voice/speed/language hash | P2 | M/L | High | Backend | TTS/media |
| Migrate JSON strings to JSONB or normalized tables | P2 | L | Medium | Backend/data | Prisma |
| Add RSS refresh observability and failure records | P2 | M | Medium | Backend/ops | RSS jobs |
| Implement account deletion/export | P2 | M | High | Backend/mobile | settings/account |
| Add E2E smoke flows for Chrome-to-mobile sync | P2 | L | High | QA/engineering | all clients |

### Long-Term Improvements

| Recommendation | Priority | Effort | Impact | Suggested owner | Related module |
|---|---:|---:|---:|---|---|
| Add billing/subscription enforcement for AI/TTS usage | P3 | L | High | Product/backend | billing |
| Add admin/support console with strict roles | P3 | L | Medium | Ops/backend | admin |
| Add offline reading/audio cache | P3 | L | Medium/High | Mobile/backend | mobile/media |
| Add direct share extensions for mobile platforms | P3 | L | Medium | Mobile | iOS/Android |
| Add analytics dashboards for activation, retention, usage, cost | P3 | M/L | High | Product/data | analytics |
| Add provider abstraction for future TTS/AI vendors | P3 | M | Medium | Backend | TTS/learning |

## 15. Final Summary

ReadMate AI is a substantial product implementation, not a throwaway prototype. The core cross-device architecture is in place: Chrome captures content, the backend stores documents and blocks, mobile loads the synced library, TTS is proxied through the backend, and learning workflows are implemented with Gemini and persisted review state.

The product is close to internal-test readiness but not fully production-ready. The highest-priority blockers are security hardening around URL ingestion, CORS, raw errors, and route-level abuse controls; the current failing API tests; and clarification of the upload contract. The most important product gaps are usage/billing controls, account deletion/export, API documentation, mobile automated tests, and operational observability for RSS/AI/TTS workflows.

Suggested next steps:

1. Fix failing tests and make the test suite green.
2. Add SSRF protection, strict production CORS, sanitized errors, and route-group rate limits.
3. Decide whether document upload officially supports PDF only or PDF/EPUB/DOC/DOCX, then update route names, tests, and docs.
4. Add usage metering before wider user testing to control provider costs.
5. Add API documentation and mobile/E2E smoke tests for the main cross-device journeys.
