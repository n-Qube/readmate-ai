# ReadMate production-readiness runbook

Last updated: 2026-08-24. This runbook distinguishes local implementation from deployed and live-verified state.

## Canonical source

- API: `apps/api`, Express/Prisma/PostgreSQL/Supabase, deployed by `cloudbuild.yaml`.
- Mobile: `apps/mobile/app.json`, `apps/mobile/app.config.js`, and `apps/mobile/eas.json`. Run Expo/EAS only from `apps/mobile`.
- Chrome extension: `apps/extension` and `apps/extension/public/manifest.json`.
- Schema: `apps/api/prisma/schema.prisma` plus every ordered directory under `apps/api/prisma/migrations`.
- Environment contract: `.env.example` and `docs/environment-matrix.md`.

No release may be built from an uncommitted or partially tracked worktree. A clean clone at the intended commit must pass `npm ci` and `npm run verify:release` before release artifacts are accepted.

## Mandatory launch gates

1. Rotate every credential that existed in `.env.local`, `.secrets`, or Expo logs. Remove revoked copies from the workspace, Trash, backups, CI artifacts, and support bundles. Run `npm run check:secrets:workspace` until it passes.
2. Confirm 2FA and least privilege for GitHub, Clerk, Supabase, Google Cloud, EAS, Apple, Google Play, Gemini, and Khaya. Use workload identity for Google APIs; do not download a Cloud Run service-account key.
3. Apply all Prisma migrations with the dedicated migration credential. Confirm the API credential logs in as exactly `readmate_api`; startup rejects any other production role.
4. Verify the production Clerk instance, live keys, OAuth redirect URIs, session policy, attack protection, and strict reverification for account deletion.
5. Configure the stable Chrome extension origin in Clerk, `EXTENSION_ORIGIN`, and the manifest host allowlist.
6. Choose one stable HTTPS web workspace hostname that is separate from the API and accounts origins. Configure it in EAS Hosting/DNS, Clerk allowed origins and redirects, API `WEB_APP_ORIGIN`, and the WebMCP origin trial only if the final Chrome channel requires it.
7. Configure EAS `development`, `preview`, and `production` environments. Production must contain a live Clerk publishable key and HTTPS production API URL; no Clerk secret, provider key, database credential, or service-role key may use an `EXPO_PUBLIC_*` name.
8. Run `npm run export:web` and inspect the exported route manifest for `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)` before any hosting upload.
9. Run focused authenticated smoke tests for tenant isolation, upload quotas, TTS quotas, account deletion reverification, nested media deletion, learning fallback, and cast playback.
10. Restore the latest production backup into a scratch project and verify row counts plus representative documents, notes, highlights, quota rows, and private-storage objects.
11. Configure monitoring, provider budgets, and on-call notification routes below.

## Deploy and rollback

`cloudbuild.yaml` is the only production candidate-build path. It builds the API test target, runs API tests/typechecks, validates the exact origins and every required enabled Secret Manager version before migration, applies migrations with `readmate-database-migration-url`, builds and pushes the `$BUILD_ID` image, resolves its immutable digest, deploys a uniquely tagged and named no-traffic candidate, verifies its exact revision/image/Ready state, checks `/health`, records 0% traffic evidence, and stops. RevenueCat mounting is disabled by default and requires the exact `_ENABLE_REVENUECAT=true` release substitution. The pipeline never promotes production traffic.

After authenticated candidate checks and explicit approval, run `scripts/promote-cloud-run-candidate.sh` with the exact revision, unique tag, and immutable image digest printed by that build. The script requires `CONFIRM_REVISION` to repeat the exact revision and `CONFIRM_DESTINATION` to repeat `<project>/<region>/<service>/<revision>`, revalidates the candidate immediately before the change, uses `--to-revisions <exact-revision>=100`, and verifies the final allocation. Never promote `LATEST` or `latestReadyRevisionName`.

Migrations must use expand/contract sequencing. A release may add nullable columns/tables/indexes and deploy compatible code. Destructive drops, renames, and non-null conversions require a later release after all active revisions no longer use the old shape.

Rollback code without rolling back schema:

```bash
gcloud run revisions list --service readmate-api --region us-central1
gcloud run services update-traffic readmate-api --region us-central1 --to-revisions <known-good-revision>=100
```

After rollback, verify `/health`, one authenticated read, one write, TTS, and error/latency dashboards. Never run `prisma migrate reset` or manually reverse a production migration during an incident.

## Backup and restore drill

- Enable Supabase point-in-time recovery or scheduled database backups at a retention period matching the privacy and business requirements.
- Enable storage inventory/export for `readmate-uploads` and `readmate-media`.
- Quarterly, restore into an isolated scratch project with no production client access. Apply the same API role grants/RLS, run integrity queries, and download representative private objects through an authenticated test account.
- Record backup timestamp, restore duration, row/object counts, failures, and the operator. Delete the scratch environment after sign-off.

## Monitoring and cost controls

Create alerts for Cloud Run 5xx rate, p95 latency, instance saturation, container restarts, candidate/startup failures, Postgres connection usage, Supabase storage growth, quota-rejection spikes, Clerk auth failures, RSS cron failures, and provider 429/5xx rates. Route high-severity alerts to a monitored on-call channel.

Cloud Run is capped at 3 instances, concurrency 10, 512 MiB, one CPU, and 60-second requests. Durable daily TTS/AI quotas, upload byte/object quotas, outbound deadlines, parser concurrency, and pending-upload expiry are application controls. Configure Google Cloud, Supabase, Gemini, Khaya, EAS, Apple, and Google Play budget alerts independently; application limits do not replace provider budgets.

Do not log tokens, authorization headers, request bodies, document text, signed URLs, provider error bodies, or environment values. Retain structured request IDs, route/status/latency, error class, quota kind, and provider name only.

## Credential rotation

For each secret: create a replacement in the provider, store it as a new managed-secret version, deploy a no-traffic candidate, preserve its exact evidence, run the relevant smoke test, obtain explicit approval, promote that exact revision with the separate script, revoke the old value, and run the redacted workspace/history scan. Database and Supabase service-role rotations also require verifying the least-privilege API role and RLS behavior. Store-console credentials should use EAS/provider-managed credential storage; local key files are prohibited.

## Incident checklist

1. Stop traffic or expensive functionality if active abuse/cost is occurring.
2. Preserve redacted logs and exact revision/build identifiers; never paste secrets into tickets.
3. Revoke exposed credentials and sessions before cleanup.
4. Roll traffic to a known-good revision when code is implicated.
5. Verify tenant isolation and deletion behavior after recovery.
6. Document impact, root cause, timeline, and preventive action.
