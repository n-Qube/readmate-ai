# Cloud Run API deployment

Production deployments use `cloudbuild.yaml`; do not deploy from a developer laptop with plaintext `--set-env-vars` secrets. The pipeline also requires the exact Chrome extension origin and exact authenticated web-app origin so API CORS remains fail-closed.

## One-time infrastructure

1. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Text-to-Speech, and Translation APIs.
2. Create Artifact Registry repository `readmate` in `us-central1`.
3. Create `readmate-api@<project>.iam.gserviceaccount.com`. Grant only the Google TTS/Translation roles required at runtime and Secret Manager access to the named runtime secrets.
4. Create separate PostgreSQL roles:
   - `readmate_api`: least-privilege runtime role, subject to RLS, stored as `readmate-database-app-url`.
   - migration role: schema owner/DDL credential, stored as `readmate-database-migration-url`; never attach it to Cloud Run.
5. Create Secret Manager secrets expected by `scripts/deploy-cloud-run-candidate.sh`:
   - `readmate-clerk-secret-key`
   - `readmate-clerk-publishable-key`
   - `readmate-database-app-url`
   - `readmate-database-migration-url`
   - `readmate-supabase-url`
   - `readmate-supabase-service-role-key`
   - `readmate-gemini-api-key`
   - `readmate-khaya-api-key`
   - `readmate-cartesia-api-key`
   - `readmate-cron-secret`
   - `readmate-webmcp-audit-digest-key` (stable random value, at least 32 characters; preferably 32 random bytes encoded as base64 or hex)

6. Before enabling Premium sales, create an enabled `latest` version of `readmate-revenuecat-secret-api-key` in Secret Manager. Set the release-only `_ENABLE_REVENUECAT=true` substitution to mount it as `REVENUECAT_SECRET_API_KEY` and set `REVENUECAT_ENTITLEMENT_ID=premium`. The default is `false`; billing-disabled releases remove any older RevenueCat binding and fail closed to Free. The RevenueCat secret is backend-only and must never be added to EAS or a public mobile/extension variable.

Keep `readmate-webmcp-audit-digest-key` stable across revisions. Rotating it intentionally breaks correlation with earlier privacy-safe WebMCP input digests, so treat a rotation as an audited operational change. The key is backend-only and must never be copied into EAS public variables or a web/native bundle.

Grant the Cloud Build service account Secret Manager version-metadata visibility for every secret named above so release preflight can verify that `latest` exists and is enabled. Grant secret-value access only to `readmate-database-migration-url`, plus permission to read pushed Artifact Registry image metadata and deploy as the ReadMate service identity. Runtime secret values are mounted into the Cloud Run revision by reference and are not read by the preflight step.

## Deploy

The production extension ID and owner-approved HTTPS web workspace origin are required; placeholders are rejected:

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions _REGION=us-central1,_EXTENSION_ORIGIN=chrome-extension://<32-character-extension-id>,_WEB_APP_ORIGIN=https://<approved-web-host>,_ENABLE_REVENUECAT=false
```

Change `_ENABLE_REVENUECAT` to `true` only after the RevenueCat secret version and store entitlement are ready. Values other than exact lowercase `true` or `false` are rejected before Secret Manager is queried.

The pipeline:

1. Builds the API test target and runs typecheck/tests.
2. Validates both exact origins, the RevenueCat opt-in value, and every required enabled `latest` Secret Manager version, including `readmate-webmcp-audit-digest-key`; failure stops before migration.
3. Runs `prisma migrate deploy` with the migration credential.
4. Pushes an immutable `$BUILD_ID` runtime image.
5. Resolves that image tag to its Artifact Registry SHA-256 digest.
6. Deploys the digest with a unique `$BUILD_ID` revision suffix and candidate tag, the least-privilege runtime credential, and bounded capacity.
7. Proves that the tag points to that exact Ready revision and digest at 0% production traffic.
8. Probes the tagged candidate `/health` endpoint, re-checks the tag mapping, prints the evidence below, and stops.

The build never changes production traffic. A successful build prints non-secret evidence in this form:

```text
candidate_release_id=<Cloud Build ID>
candidate_revision=<exact Cloud Run revision>
candidate_tag=<unique candidate tag>
candidate_image=<Artifact Registry image@sha256:digest>
candidate_url=<tagged no-traffic URL>
candidate_health_http_status=200
candidate_traffic_percent=0
release_gate=manual_exact_revision_promotion_required
```

`prisma migrate deploy` still runs before the candidate is created, but only after release preflight passes. Submit a build only after confirming every pending migration is forward-compatible with the currently serving revision.

The candidate receives `EXTENSION_ORIGIN` and `WEB_APP_ORIGIN` as separate non-secret values. `scripts/deploy-cloud-run-candidate.sh` rejects a missing/wildcard origin, an extension lookalike, HTTP web origins, credentials, paths, queries, and fragments. With RevenueCat disabled, it does not reference the optional secret and explicitly removes any stale RevenueCat secret/entitlement configuration. Adding or changing either production origin still requires an owner-approved API deployment.

The runtime image also contains the pinned Nano-Twi v1.0 ONNX bundle, verified during the container build by SHA-256. `NANO_TWI_MODEL_DIR` points at the bundled files, `NANO_TWI_NUM_THREADS` limits CPU inference, and the challenge candidate sets `TWI_TTS_PROVIDER=nano-twi` so Asante Twi does not depend on the currently exhausted Khaya call quota. Removing that preference restores Khaya-first behavior with Nano-Twi as a speech-only fallback. The fallback still uses the existing Google Translation path before local synthesis; it does not cover Ewe, Ga, or Akuapem Twi.

## Verify

Health alone is not release verification. Preserve all seven evidence values and run authenticated control/trigger checks against the exact `candidate_url` for:

- owner and cross-user document access;
- signed upload, aggregate quota rejection, PDF extraction, and cleanup;
- TTS/learning success and durable quota rejection;
- RSS cron with an invalid and valid secret;
- account deletion strict reverification and nested media deletion;
- extension save retry behavior and mobile sign-out cache isolation.

Confirm the tag still resolves to `candidate_revision`, the revision still reports `candidate_image`, and traffic is still 0% before requesting promotion approval.

## Promote an approved exact revision

Promotion is a separate production action and is not part of `cloudbuild.yaml`. Use only the three exact values emitted by the same candidate build; never substitute `LATEST`, `latestReadyRevisionName`, or a different candidate tag/image. Set `CONFIRM_REVISION` to the same revision and bind the approval to the exact project, region, service, and revision with `CONFIRM_DESTINATION`:

```bash
CONFIRM_REVISION='<candidate_revision>' \
CONFIRM_DESTINATION='<project>/<region>/<service>/<candidate_revision>' \
  scripts/promote-cloud-run-candidate.sh \
  '<candidate_revision>' \
  '<candidate_tag>' \
  '<candidate_image>' \
  us-central1 \
  readmate-api \
  '<project-id>'
```

The promotion script revalidates the tag, image digest, Ready state, 0% allocation, and health immediately before sending traffic to `candidate_revision=100`. It then verifies that the exact revision has 100% and all other revisions have 0%. If any identity or state changed, it exits without requesting a traffic update.

After promotion, verify the service URL, one authenticated read, one write, TTS, and monitoring. Retain the prior production revision name as the rollback target.

Use `docs/production-readiness-runbook.md` for rollback, backup restore, monitoring, budgets, and credential rotation.
