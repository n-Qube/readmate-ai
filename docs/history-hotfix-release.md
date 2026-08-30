# History-data protection hotfix release

`cloudbuild.history-hotfix.yaml` is a deliberately isolated Cloud Run candidate
path for the history-data protection fix. It is not the normal release pipeline.
Its destination is hard-pinned to project `billbridge-c684f`, region
`us-central1`, and service `readmate-api`.

The path:

1. is submitted with `--no-source`, so the ordinary dirty workspace cannot be
   uploaded or trusted by Cloud Build;
2. downloads the exact production baseline archive and sealed release archive
   by immutable Cloud Storage object generation;
3. independently verifies both archive hashes, safely extracts both archives,
   recomputes their source trees, and permits changes only to the history route,
   its regression test, and the no-traffic candidate deploy script;
4. validates the canonical release manifest and its separately approved hash;
5. builds the Docker `test` target, which runs the API typecheck and test suite;
6. builds and pushes a uniquely tagged API image;
7. resolves that image to its immutable Artifact Registry digest;
8. requires exactly one revision to hold 100% of production traffic and requires
   it to also be Cloud Run's latest created revision, so an older unpromoted
   candidate can never become the inherited configuration baseline;
9. snapshots that live revision's configuration and production traffic;
10. creates a uniquely named and tagged **no-traffic** candidate using only the
   image, revision suffix, and tag flags;
11. confirms that environment variables, Secret Manager references, service
   identity, resources, scaling, ports, probes, commands, arguments, timeout,
   and configuration-relevant Cloud Run revision annotations match the existing
   Cloud Run revision;
12. confirms existing production traffic is unchanged, checks `/health`, prints
   auditable evidence, and stops.

This path contains no database deployment step and no production traffic
promotion step. Do not add credentials, environment values, resource flags, or
traffic commands to it. If the history fix turns out to require a schema change,
stop using this path and plan a normal forward-compatible release instead.

Run the local regression guard before submitting anything:

```sh
bash scripts/tests/cloud-run-history-hotfix-pipeline.test.sh
```

## Bind the candidate to the exact production source

Work only in a temporary release directory copied from the exact production
Cloud Build source archive. Do not prepare or seal the release in the ordinary
dirty workspace. The preparation tool extracts the verified baseline archive
itself; it does not accept an independently supplied baseline directory. The
release copy may differ only in:

- `apps/api/src/routes/documents.ts`
- `apps/api/src/routes/documents.test.ts`
- `scripts/deploy-cloud-run-history-hotfix-candidate.sh`

After independently recording the downloaded archive SHA-256, prepare the
canonical manifest:

```sh
python3 scripts/history_hotfix_source_manifest.py prepare \
  --release-root '<isolated hotfix release source>' \
  --baseline-archive '<downloaded production source.tgz>' \
  --baseline-source-uri 'gs://billbridge-c684f_cloudbuild/source/1787962486.04173-3e46e8f399514f2794e4cd9deb013a99.tgz' \
  --baseline-source-generation '1787962489770532' \
  --expected-baseline-archive-sha256 '<independently recorded archive sha256>'
```

Preserve the emitted manifest SHA-256 separately, then create a deterministic
sealed archive. The seal command re-verifies the manifest and source tree,
creates the archive outside the release directory, safely re-extracts it, and
verifies the re-extracted tree before reporting its SHA-256:

```sh
python3 scripts/history_hotfix_source_manifest.py seal \
  --root '<isolated hotfix release source>' \
  --output '<temporary directory>/source.tgz' \
  --expected-manifest-sha256 '<release_manifest_sha256>' \
  --expected-baseline-source-uri 'gs://billbridge-c684f_cloudbuild/source/1787962486.04173-3e46e8f399514f2794e4cd9deb013a99.tgz' \
  --expected-baseline-source-generation '1787962489770532' \
  --expected-baseline-archive-sha256 '<baseline_archive_sha256>'
```

The sealed archive is uploaded only after an action-time approval. Use a
content-addressed, write-once object and the `0` generation precondition so an
existing object can never be overwritten:

```sh
gcloud storage cp \
  '<temporary directory>/source.tgz' \
  'gs://billbridge-c684f_cloudbuild/history-hotfix/releases/<sealed_release_archive_sha256>/source.tgz' \
  --if-generation-match=0
```

Record the new object's generation, download that exact `URI#generation` into a
fresh temporary location, and confirm its SHA-256 again before starting a
build. The bucket remains private.

After the exact baseline, three-file diff, sealed object generation, archive
hash, manifest hash, and build-config hash have been reviewed, an authorized
operator may submit a candidate build. The helper refuses to contact Cloud
Build unless `CONFIRM_CONFIG_SHA256` repeats the exact external config hash.
It first copies the build definition into a private temporary snapshot, hashes
that snapshot, and submits that same snapshot, so a later workspace edit cannot
change the already-approved build:

```sh
CONFIRM_CONFIG_SHA256='<cloudbuild_config_sha256>' \
  scripts/submit-cloud-run-history-hotfix-candidate.sh \
  'gs://billbridge-c684f_cloudbuild/source/1787962486.04173-3e46e8f399514f2794e4cd9deb013a99.tgz' \
  '1787962489770532' \
  '<baseline_archive_sha256>' \
  'gs://billbridge-c684f_cloudbuild/history-hotfix/releases/<sealed_release_archive_sha256>/source.tgz' \
  '<sealed_release_source_generation>' \
  '<sealed_release_archive_sha256>' \
  '<release_manifest_sha256>'
```

The helper always passes `--no-source`. The external Cloud Build definition
downloads and validates both immutable archives; it never executes a verifier
from the release archive.

Preserve all printed evidence. The build ends with
`release_gate=no_traffic_no_promotion`; it is not proof that production was
updated. Authenticated, cross-account history-preservation checks must pass on
the exact candidate URL before anyone separately approves production traffic.

## Explicit promotion after approval

Only `scripts/promote-cloud-run-history-hotfix-candidate.sh` may promote this
candidate. It accepts the exact revision, `history-hotfix-*` tag, immutable image,
pre-hotfix live revision, and baseline configuration hash printed by the same
candidate build. It requires `CONFIRM_REVISION` to repeat the exact candidate
revision before it contacts Cloud Run:

```sh
CONFIRM_REVISION='<candidate_revision>' \
  scripts/promote-cloud-run-history-hotfix-candidate.sh \
  '<candidate_revision>' \
  '<candidate_tag>' \
  '<candidate_image>' \
  '<history_hotfix_base_revision>' \
  '<history_hotfix_base_config_sha256>'
```

The promotion guard revalidates the hard-pinned destination, exact tag/revision
pair, immutable image digest, candidate and baseline configuration, single 100%
live baseline, zero candidate traffic, and candidate health. Immediately before
the change it repeats those checks against the Cloud Run v2 service, requires a
fully reconciled generation, and binds the traffic-only PATCH to that exact
service `etag`. It preserves existing revision tags, assigns 100% only to the
exact candidate revision, never targets `LATEST`, never retries an etag
conflict, waits for the provider operation, and verifies that exact revision is
the sole live revision afterward. Never use a manual traffic command.
