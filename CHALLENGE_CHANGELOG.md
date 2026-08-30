# ReadMate AI WebMCP Challenge work

This document distinguishes the pre-existing ReadMate product from the work added for the OpenAI WebMCP Challenge submission period, which began August 25, 2026. It is intended to accompany dated public commits as the equivalent source-level evidence required for a pre-existing project.

Public challenge commit range: `[CHALLENGE_COMMIT_RANGE]`

## Product that existed before the challenge

ReadMate already had a Manifest V3 Chrome extension, an Expo mobile app, an authenticated Node/Express API, a synchronized reading library, webpage/PDF ingestion, playback controls, Clerk identity, PostgreSQL persistence, and English plus hosted Ghanaian-language speech integrations. Those baseline features are context, not the work being entered for evaluation.

## Meaningful additions during the challenge period

| Addition | Primary source evidence | Verification evidence |
| --- | --- | --- |
| Six bounded WebMCP tools for search, document context, listening preparation, webpage saving, RSS subscription, and study generation | `apps/mobile/src/webmcp/tool-contracts.ts`, `apps/mobile/src/webmcp/register-tools.web.ts` | `apps/mobile/src/webmcp/tool-contracts.test.ts`, registration lifecycle tests |
| Imperative handlers that return compact owned context and update only visible player state | `apps/mobile/src/webmcp/imperative-handlers.ts` | handler and tool-result tests |
| Declarative, model-readable forms for writes and quota-consuming AI work | `apps/mobile/src/webmcp/forms/` | form, completion, idempotency, and replay tests |
| Route gating that excludes account, billing, password, deletion, and provider-secret surfaces | `apps/mobile/src/webmcp/route-policy.ts` | route-policy and registration lifecycle tests |
| Prompt-injection, confirmation, ownership, audit-digest, replay, and durable paid-effect boundaries | `apps/api/src/webmcp/`, `apps/api/src/routes/content.ts`, `apps/api/src/routes/learning.ts` | API WebMCP, content, learning, and migration tests |
| A deterministic WebMCP evaluation dataset covering expected calls, clarification, refusal, and adversarial content | `apps/mobile/src/webmcp/evals/` | dataset and tool-outcome tests |
| A dedicated authenticated web workspace with WebMCP response headers and a no-cost guarded Firebase adapter | `apps/mobile/app/`, `apps/mobile/scripts/firebase-hosting-*.cjs`, `apps/mobile/firebase.web.json` | adapter, release-guard, emulator, and live HTTPS checks |
| Public judge landing and original Ghana demonstration article | `apps/mobile/public/challenge.html`, `apps/mobile/public/challenge-demo.html` | live `/challenge` and `/challenge-demo` responses and in-app-browser rendering |
| Explicit challenge launch that skips consumer onboarding without changing ordinary first-run behavior | `apps/mobile/src/utils/challenge-entry.ts`, `apps/mobile/app/index.tsx` | `challenge-entry.test.ts` and live launch-link QA |
| No-subscription Asante Twi fallback using a pinned Nano-Twi ONNX model | `apps/api/src/nanoTwi.ts`, container build scripts and model checksum configuration | Nano-Twi tests, exact candidate image synthesis, and recorded WAV artifact |
| No-cost production sign-in policy that removes SMS OTP from live mobile/web and extension builds | `apps/mobile/src/components/sign-in-screen.tsx`, `apps/extension/src/sidepanel/authIdentifier.ts`, `apps/extension/src/sidepanel/main.tsx` | extension OTP-policy tests, full extension suite, and guarded live-key build |
| Submission, deployment, safety, and public-repository documentation | `README.md`, `docs/webmcp-challenge-submission.md`, `docs/webmcp-deployment.md`, `CONTRIBUTING.md`, `SECURITY.md` | publication and secret-hygiene preflights |

## Current dated deployment evidence

- August 30, 2026: dedicated Firebase project/site `readmate-ai-9df42` created on the no-cost Spark plan.
- August 30, 2026 at 09:05 UTC: guarded preview artifact `5c4e70dc5a92da9879979ff5a2715e5006e83c10c1070a579540292491210993` deployed.
- August 30, 2026: `/challenge`, `/challenge-demo`, and `/challenge-feed.xml` returned 200 with the required WebMCP/security headers; the Atom feed was served as XML, the pinned candidate API returned 200, and exact CORS preflights passed for the selected web and extension origins.
- August 30, 2026: extension 0.1.5 production SMS OTP removal passed 146 tests, type-checking, and a guarded live-Clerk build; QA archive SHA-256 `f15547737c52b611c78b47551c5e5967f29563706943f19596374273d872942d` contains the stable and exact candidate API hosts and no path-traversal entries.

## Publication rule

Before submission, replace the commit-range placeholder with links or hashes from the public repository. Preserve this file, the dated commits, and the live deployment unchanged through the judging period except for an organizer-approved correction. Do not describe pre-existing mobile, extension, reading, or speech functionality as new challenge work.
