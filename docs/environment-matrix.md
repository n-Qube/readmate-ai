# ReadMate environment matrix

This file is the configuration source of truth. Secret values belong in managed provider stores, never in Git, EAS JSON, Expo logs, build archives, or repository-resident dotfiles.

| Surface | Development | Preview | Production |
| --- | --- | --- | --- |
| API | local Express or isolated Cloud Run | isolated non-production API/database | `readmate-api` Cloud Run service |
| Clerk | development instance, test keys | development/staging instance, test keys | production instance, `pk_live_`/`sk_live_` |
| Database | disposable local/staging DB | staging Supabase project | production Supabase project; API connects as `readmate_api` |
| Mobile ID | `ai.readmate.mobile.dev` | `ai.readmate.mobile.preview` | `ai.readmate.mobile` |
| EAS environment/channel | `development` / `development` | `preview` / `preview` | `production` / `production` |
| Expo web workspace | local Expo web server | immutable EAS Hosting preview | owner-approved stable HTTPS origin, separate from accounts and API |
| Extension | unpacked development build | explicitly labelled test build | stable Web Store ID and exact origin allowlist |

## Public client variables

Only these may be exposed in client bundles:

- Expo mobile/web: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_READMATE_API_URL`, RevenueCat client SDK keys and entitlement ID for native purchases, and `EXPO_PUBLIC_SCREENSHOT_MODE` for controlled non-production capture only.
- Extension: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_SYNC_HOST`, `VITE_READMATE_API_URL`, `VITE_ENABLE_CLERK_UI`.

Production mobile, web, and extension builds fail if configured with test Clerk identity, local/development hosts, a non-HTTPS API, or disabled Clerk UI. `apps/mobile/scripts/public-env-contract.cjs` is the Expo public-variable allowlist. An `EXPO_PUBLIC_*` prefix means the value is bundled into the client; it is not a secret store.

## API variables

Required in production: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `DATABASE_URL`, `DATABASE_APP_ROLE=readmate_api`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `WEBMCP_AUDIT_DIGEST_KEY`, `EXTENSION_ORIGIN`, `WEB_APP_ORIGIN`, and `ALLOW_ANONYMOUS_TTS=false`.

`EXTENSION_ORIGIN` must be one exact production `chrome-extension://` origin. `WEB_APP_ORIGIN` must be one exact HTTPS origin with no path, query, credentials, or wildcard. The API combines only those two explicit variables into its browser CORS allowlist. The owner must choose the final web hostname before Clerk, Cloud Run, DNS, or EAS Hosting is changed.

`WEBMCP_AUDIT_DIGEST_KEY` is a backend-only stable digest key with at least 32 characters, preferably 32 random bytes encoded as base64 or hex. Store it as `readmate-webmcp-audit-digest-key` in Google Secret Manager and keep it stable across revisions so privacy-safe audit digests remain correlatable. Never use an `EXPO_PUBLIC_*` name for it.

Premium purchase verification additionally requires the backend-only RevenueCat secret API key in `REVENUECAT_SECRET_API_KEY`. Cloud Run releases mount it only when the validated `_ENABLE_REVENUECAT=true` substitution is explicitly supplied; the default is `false`. `REVENUECAT_ENTITLEMENT_ID` defaults to `premium` and must match the entitlement attached to both the App Store and Google Play products. Do not put the secret key in EAS, an `EXPO_PUBLIC_*` variable, a mobile bundle, or extension configuration. If RevenueCat is absent or unavailable, store-derived Premium access fails closed; manual server grants and trusted Clerk Premium claims remain available for controlled support cases.

Provider and capacity variables are listed in `.env.example`. Google Cloud TTS/Translation should use the Cloud Run service identity rather than a downloaded service-account key. `READMATE_ENV_FILE`, when used locally, must point outside the repository.

## Ownership and outage behavior

| Service | Purpose | Credential/identity | Expected outage behavior |
| --- | --- | --- | --- |
| Clerk | identity and sessions | live backend secret + publishable client key | authenticated routes fail closed; no anonymous paid usage |
| Supabase Postgres | user data and durable quotas | least-privilege `readmate_api`; separate migration role | startup preflight or requests fail; no RLS bypass |
| Supabase Storage | private uploads/media | backend service role only | upload/cast operations return stable failure; DB quota records remain conservative |
| Google Cloud | Cloud Run, TTS, Translation | workload identity | speech/translation fails with bounded provider error |
| Gemini | learning generation | Secret Manager API key | extractive fallback is used where supported |
| Khaya | Ghanaian-language translation/TTS | Secret Manager subscription key | stable provider-unavailable response |
| RevenueCat | verifies App Store and Google Play Premium entitlements | backend secret API key in Secret Manager | store-derived Premium access fails closed; clients may retry entitlement refresh |
| EAS / Apple / Google Play | mobile build and distribution | provider-managed remote credentials | release stops; runtime service is unaffected |

Account ownership, billing contacts, 2FA status, and provider status-page subscriptions must be recorded in the private operations vault, not this public repository.
