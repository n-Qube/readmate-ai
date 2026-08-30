# Security remediation record — 2026-08-24

Source scan: `4cf5b760-c22d-432a-8959-8f7b2e7c9344` (18 findings: 3 high, 11 medium, 4 low).

This record distinguishes a local code fix from a completed production control. The code-addressable portions of all 18 findings are implemented. Finding 3 remains a production blocker until the exposed credentials are rotated and the remaining plaintext copies are removed. Deployment, dashboard configuration, and physical-device checks are tracked separately in `docs/release-blockers.md`.

| # | Finding | Local remediation and evidence | Status |
|---|---|---|---|
| 1 | Express async rejections bypass error middleware | Added the shared async route wrapper and regression coverage in `apps/api/src/asyncHandler.test.ts`. | Fixed locally |
| 2 | DNS rebinding bypasses remote-fetch validation | Remote fetches now resolve, validate, and pin the destination IP for every redirect while preserving the hostname for TLS. Covered by `apps/api/src/safeRemoteFetch.test.ts`. | Fixed locally |
| 3 | High-privilege credentials in plaintext and Expo logs | Purged generated secret-bearing Expo logs, blocked repository-root env loading, added redacted workspace/history scanning, and documented managed-secret rotation. Existing plaintext credential files must be rotated and removed before release. | External rotation open |
| 4 | Unbounded upload and document-processing resources | Added atomic byte/object/pending-upload quotas, stale-pending cleanup, and one shared bounded PDF work limiter for signed and multipart uploads. Covered by upload and limiter tests. | Fixed locally |
| 5 | Provider calls have no bounded timeout | Added abortable deadlines across Google, Cartesia, Khaya, Gemini, and Supabase calls. Covered by `apps/api/src/fetchWithTimeout.test.ts`. | Fixed locally |
| 6 | Learning review creates excessive database fan-out | Replaced per-item database work with bounded bulk SQL/grouping and capped attempts per document. Covered by learning route tests. | Fixed locally |
| 7 | Chromecast sends private audio over cleartext HTTP | Added an authenticated, quota-enforced cast synthesis endpoint backed by short-lived private HTTPS media URLs; Android rejects non-HTTPS cast media. Native release Kotlin compilation passes. | Fixed locally |
| 8 | Paid TTS and AI operations lack durable usage limits | Added atomic daily usage buckets and 429 enforcement for paid operations, plus cleanup during account deletion. Schema and migrations validate. | Fixed locally |
| 9 | Account deletion lacks step-up authentication | The API requires Clerk strict reverification and the mobile client performs reverification before deletion. Covered by account route tests. | Fixed locally |
| 10 | Store mobile profile mixes test Clerk identity with production API | Canonical Expo configuration now has isolated development/preview/production identities, remote EAS environments, release-time live-key/HTTPS validation, and no hardcoded production API fallback. | Fixed locally |
| 11 | Extension retries non-idempotent mutations | Automatic retries are limited to idempotent methods; POST mutations are sent once. Covered by `apps/extension/src/api/client.test.ts`. | Fixed locally |
| 12 | API role can forge the RLS service bypass | Removed the request-controlled bypass flag, added a migration that disables it, narrowed the RSS service function, and made production startup require the `readmate_api` login. | Fixed locally; deploy migration required |
| 13 | Sign-out/deletion can render the prior user's mobile state | User identity now keys the application/query/playback scope and clears cached speech state on principal changes. | Fixed locally; device test required |
| 14 | Hostile webpages can cause unbounded extraction/message ingestion | Added strict message schemas, sender/freshness checks, and bounded DOM roots/elements/characters/chunks/time. Covered by message and hostile-extraction tests. | Fixed locally |
| 15 | TTS routes expose raw provider failures | Upstream response bodies remain private; clients receive stable generic status responses. Covered by TTS route tests. | Fixed locally |
| 16 | CORS fails open when the extension origin is absent | Production startup now requires one exact extension origin and the CORS policy rejects all other origins. Covered by `apps/api/src/corsPolicy.test.ts`. | Fixed locally |
| 17 | Account deletion misses nested generated media | Storage cleanup recursively pages every nested user prefix. Covered by media/account tests. | Fixed locally |
| 18 | Chromecast local server has unbounded threads/header input | Removed the Android LAN media server entirely; casting uses the bounded backend HTTPS flow. Native release Kotlin compilation passes. | Fixed locally |

## Verification evidence

- Clean `npm ci` under Node 24 succeeded from the current lockfile.
- The non-secret portion of the release gate passed: dependency gate, all three workspace typechecks, 110 API tests, 60 extension tests, Prisma generation, API build, and extension production build.
- `npm run verify:release` now includes the workspace secret scan and intentionally remains red until the seven known plaintext credential files are rotated and removed.
- `./gradlew :readmate-airplay:compileReleaseKotlin` passed with 58 tasks.
- Prisma and CI/Cloud Build YAML configuration parse successfully.
- Dependency gate: 0 critical, 3 documented Prisma CLI high, and 25 reviewed upstream moderate advisories. See `docs/dependency-risk-register.md`.
- Docker image execution was not locally verified because Docker is not installed on this workstation; Cloud Build's test target is the deployment gate.
