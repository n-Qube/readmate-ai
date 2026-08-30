#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

FAKE_GCLOUD="${ROOT_DIR}/scripts/tests/fixtures/fake-gcloud-history-hotfix.sh"
FAKE_CURL="${ROOT_DIR}/scripts/tests/fixtures/fake-curl.sh"
GCLOUD_LOG="${TEMP_DIR}/gcloud.log"
CURL_LOG="${TEMP_DIR}/curl.log"
STATE_FILE="${TEMP_DIR}/state"

touch "${GCLOUD_LOG}" "${CURL_LOG}" "${STATE_FILE}"

fail() {
  echo "$*" >&2
  exit 1
}

assert_contains() {
  local value="$1"
  local expected="$2"
  [[ "${value}" == *"${expected}"* ]] || fail "Expected output to contain: ${expected}"
}

assert_not_contains() {
  local value="$1"
  local unexpected="$2"
  [[ "${value}" != *"${unexpected}"* ]] || fail "Expected output not to contain: ${unexpected}"
}

bash -n \
  "${ROOT_DIR}/scripts/deploy-cloud-run-history-hotfix-candidate.sh" \
  "${ROOT_DIR}/scripts/submit-cloud-run-history-hotfix-candidate.sh" \
  "${ROOT_DIR}/scripts/promote-cloud-run-history-hotfix-candidate.sh" \
  "${FAKE_GCLOUD}"
python3 "${ROOT_DIR}/scripts/history_hotfix_source_manifest.py" --help >/dev/null
bash "${ROOT_DIR}/scripts/tests/history-hotfix-source-manifest.test.sh"
bash "${ROOT_DIR}/scripts/tests/cloudbuild-history-hotfix-source-gate.test.sh"

CLOUDBUILD_CONTENT="$(<"${ROOT_DIR}/cloudbuild.history-hotfix.yaml")"
CANDIDATE_SCRIPT_CONTENT="$(<"${ROOT_DIR}/scripts/deploy-cloud-run-history-hotfix-candidate.sh")"
PROMOTION_SCRIPT_CONTENT="$(<"${ROOT_DIR}/scripts/promote-cloud-run-history-hotfix-candidate.sh")"
SUBMIT_SCRIPT_CONTENT="$(<"${ROOT_DIR}/scripts/submit-cloud-run-history-hotfix-candidate.sh")"
DOCKERFILE_CONTENT="$(<"${ROOT_DIR}/Dockerfile")"
extract_step_script() {
  local step_id="$1"
  awk -v step_id="${step_id}" '
    $0 == "  - id: " step_id { in_step = 1; next }
    in_step && /^      - \|$/ { capture = 1; next }
    capture && /^  - id:/ { exit }
    capture { sub(/^        /, ""); print }
  ' "${ROOT_DIR}/cloudbuild.history-hotfix.yaml"
}

FETCH_GATE_SCRIPT="$(extract_step_script fetch-generation-locked-sealed-release)"
VERIFY_GATE_SCRIPT="$(extract_step_script verify-generation-locked-sealed-release)"
SOURCE_GATE_SCRIPT="${FETCH_GATE_SCRIPT}
${VERIFY_GATE_SCRIPT}"

assert_contains "${CLOUDBUILD_CONTENT}" "--target"
assert_contains "${CLOUDBUILD_CONTENT}" "test"
assert_contains "${CLOUDBUILD_CONTENT}" "fetch-generation-locked-sealed-release"
assert_contains "${CLOUDBUILD_CONTENT}" "verify-generation-locked-sealed-release"
assert_contains "${CLOUDBUILD_CONTENT}" 'gcloud storage cp "$${BASELINE_URI}#$${BASELINE_GENERATION}"'
assert_contains "${CLOUDBUILD_CONTENT}" 'gcloud storage cp "$${RELEASE_URI}#$${RELEASE_GENERATION}"'
assert_contains "${CLOUDBUILD_CONTENT}" "source_isolation=generation-locked-baseline-and-sealed-release"
assert_contains "${CLOUDBUILD_CONTENT}" "Cloud Build workspace is not empty; submit this config with --no-source"
assert_contains "${CLOUDBUILD_CONTENT}" "dir: release"
assert_contains "${CLOUDBUILD_CONTENT}" "_EXPECTED_RELEASE_MANIFEST_SHA256"
assert_contains "${CLOUDBUILD_CONTENT}" "_BASELINE_SOURCE_URI"
assert_contains "${CLOUDBUILD_CONTENT}" "_BASELINE_SOURCE_GENERATION"
assert_contains "${CLOUDBUILD_CONTENT}" "_BASELINE_ARCHIVE_SHA256"
assert_contains "${CLOUDBUILD_CONTENT}" "_SEALED_RELEASE_SOURCE_URI"
assert_contains "${CLOUDBUILD_CONTENT}" "_SEALED_RELEASE_SOURCE_GENERATION"
assert_contains "${CLOUDBUILD_CONTENT}" "_SEALED_RELEASE_ARCHIVE_SHA256"
assert_contains "${CLOUDBUILD_CONTENT}" 'READMATE_BASELINE_URI=${_BASELINE_SOURCE_URI}'
assert_contains "${CLOUDBUILD_CONTENT}" "us-central1-docker.pkg.dev/billbridge-c684f/readmate/readmate-api:history-hotfix-\$BUILD_ID"
assert_contains "${CLOUDBUILD_CONTENT}" "scripts/deploy-cloud-run-history-hotfix-candidate.sh"
assert_contains "${CLOUDBUILD_CONTENT}" 'required_changes = sorted(['
assert_not_contains "${CLOUDBUILD_CONTENT}" "scripts/history_hotfix_source_manifest.py"
assert_not_contains "${CLOUDBUILD_CONTENT}" "_EXPECTED_BASELINE_SOURCE_URI"
assert_not_contains "${CLOUDBUILD_CONTENT}" "_EXPECTED_BASELINE_SOURCE_GENERATION"
assert_not_contains "${CLOUDBUILD_CONTENT}" "_EXPECTED_BASELINE_ARCHIVE_SHA256"
assert_not_contains "${SOURCE_GATE_SCRIPT}" '${_'
(( ${#FETCH_GATE_SCRIPT} <= 10000 )) || fail "Fetch source-gate argument exceeds Cloud Build's 10,000-character limit."
(( ${#VERIFY_GATE_SCRIPT} <= 10000 )) || fail "Verify source-gate argument exceeds Cloud Build's 10,000-character limit."
assert_not_contains "${CLOUDBUILD_CONTENT}" "\${_REGION}"
assert_not_contains "${CLOUDBUILD_CONTENT}" "\${_SERVICE_NAME}"
assert_not_contains "${CLOUDBUILD_CONTENT}" "prisma"
assert_not_contains "${CLOUDBUILD_CONTENT}" "migration"
assert_not_contains "${CLOUDBUILD_CONTENT}" "availableSecrets"
assert_not_contains "${CLOUDBUILD_CONTENT}" "secretEnv"
assert_not_contains "${CLOUDBUILD_CONTENT}" "promote-cloud-run"
assert_not_contains "${CLOUDBUILD_CONTENT}" "update-traffic"

SOURCE_GATE_LINE="$(grep -n 'id: fetch-generation-locked-sealed-release' "${ROOT_DIR}/cloudbuild.history-hotfix.yaml" | cut -d: -f1)"
VERIFY_GATE_LINE="$(grep -n 'id: verify-generation-locked-sealed-release' "${ROOT_DIR}/cloudbuild.history-hotfix.yaml" | cut -d: -f1)"
API_TEST_LINE="$(grep -n 'id: api-tests' "${ROOT_DIR}/cloudbuild.history-hotfix.yaml" | cut -d: -f1)"
[[ -n "${SOURCE_GATE_LINE}" && -n "${VERIFY_GATE_LINE}" && -n "${API_TEST_LINE}" \
  && "${SOURCE_GATE_LINE}" -lt "${VERIFY_GATE_LINE}" && "${VERIFY_GATE_LINE}" -lt "${API_TEST_LINE}" ]] \
  || fail "Source isolation must run before API tests and every build/deploy step."

assert_contains "${DOCKERFILE_CONTENT}" "FROM build AS test"
assert_contains "${DOCKERFILE_CONTENT}" "RUN npm run typecheck -w apps/api"
assert_contains "${DOCKERFILE_CONTENT}" "RUN npm test -w apps/api"

assert_contains "${CANDIDATE_SCRIPT_CONTENT}" '--image="${IMMUTABLE_IMAGE}"'
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" "--no-traffic"
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" '--revision-suffix="${REVISION_SUFFIX}"'
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" '--tag="${CANDIDATE_TAG}"'
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" "revision_config_digest"
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" "production_traffic_digest"
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" 'readonly PROJECT_ID="billbridge-c684f"'
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" 'readonly REGION="us-central1"'
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" 'readonly SERVICE_NAME="readmate-api"'
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" '"annotations": annotations'
assert_not_contains "${CANDIDATE_SCRIPT_CONTENT}" "update-traffic"
assert_not_contains "${CANDIDATE_SCRIPT_CONTENT}" "latestReadyRevisionName"
assert_not_contains "${CANDIDATE_SCRIPT_CONTENT}" "--to-latest"

for forbidden_flag in \
  --set-env-vars --update-env-vars --remove-env-vars --clear-env-vars \
  --set-secrets --update-secrets --remove-secrets --clear-secrets \
  --memory --cpu --concurrency --timeout --min-instances --max-instances \
  --service-account --allow-unauthenticated --no-allow-unauthenticated \
  --port --command --args --ingress --vpc-connector --network \
  --add-cloudsql-instances --clear-cloudsql-instances; do
  assert_not_contains "${CANDIDATE_SCRIPT_CONTENT}" "${forbidden_flag}"
done

assert_contains "${PROMOTION_SCRIPT_CONTENT}" 'readonly PROJECT_ID="billbridge-c684f"'
assert_contains "${PROMOTION_SCRIPT_CONTENT}" 'readonly REGION="us-central1"'
assert_contains "${PROMOTION_SCRIPT_CONTENT}" 'readonly SERVICE_NAME="readmate-api"'
assert_contains "${PROMOTION_SCRIPT_CONTENT}" 'history-hotfix-'
assert_contains "${PROMOTION_SCRIPT_CONTENT}" 'CONFIRM_REVISION'
assert_contains "${PROMOTION_SCRIPT_CONTENT}" 'promotion_precondition=cloud-run-v2-etag'
assert_contains "${PROMOTION_SCRIPT_CONTENT}" '"etag": etag'
assert_contains "${PROMOTION_SCRIPT_CONTENT}" 'updateMask=traffic'
assert_not_contains "${PROMOTION_SCRIPT_CONTENT}" "run services update-traffic"
assert_not_contains "${PROMOTION_SCRIPT_CONTENT}" "latestReadyRevisionName"
assert_not_contains "${PROMOTION_SCRIPT_CONTENT}" "--to-latest"

assert_contains "${SUBMIT_SCRIPT_CONTENT}" '--no-source'
assert_contains "${SUBMIT_SCRIPT_CONTENT}" 'CONFIRM_CONFIG_SHA256'
assert_contains "${SUBMIT_SCRIPT_CONTENT}" 'CONFIG_SNAPSHOT_DIR="$(mktemp -d)"'
assert_contains "${SUBMIT_SCRIPT_CONTENT}" '--config="${CONFIG_SNAPSHOT}"'
assert_not_contains "${SUBMIT_SCRIPT_CONTENT}" '--config="${CONFIG_PATH}"'
assert_contains "${SUBMIT_SCRIPT_CONTENT}" 'readonly PROJECT_ID="billbridge-c684f"'
assert_contains "${SUBMIT_SCRIPT_CONTENT}" 'readonly BUILD_REGION="global"'
assert_contains "${SUBMIT_SCRIPT_CONTENT}" 'gs://billbridge-c684f_cloudbuild/history-hotfix/releases/*.tgz'
assert_contains "${SUBMIT_SCRIPT_CONTENT}" '_BASELINE_SOURCE_GENERATION='
assert_contains "${SUBMIT_SCRIPT_CONTENT}" '_SEALED_RELEASE_SOURCE_GENERATION='
assert_not_contains "${SUBMIT_SCRIPT_CONTENT}" ' "$ROOT_DIR"'

CONFIG_SHA256="$(python3 -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "${ROOT_DIR}/cloudbuild.history-hotfix.yaml")"
BASELINE_SOURCE_URI="gs://billbridge-c684f_cloudbuild/source/production.tgz"
BASELINE_SOURCE_GENERATION="1787962489770532"
BASELINE_ARCHIVE_SHA256="$(printf 'b%.0s' {1..64})"
SEALED_ARCHIVE_SHA256="$(printf 'c%.0s' {1..64})"
SEALED_SOURCE_URI="gs://billbridge-c684f_cloudbuild/history-hotfix/releases/${SEALED_ARCHIVE_SHA256}/source.tgz"
SEALED_SOURCE_GENERATION="1788000000000000"
RELEASE_MANIFEST_SHA256="$(printf 'd%.0s' {1..64})"

: >"${GCLOUD_LOG}"
if FAKE_GCLOUD_LOG="${GCLOUD_LOG}" FAKE_GCLOUD_STATE="${STATE_FILE}" GCLOUD="${FAKE_GCLOUD}" \
  bash "${ROOT_DIR}/scripts/submit-cloud-run-history-hotfix-candidate.sh" \
    "${BASELINE_SOURCE_URI}" "${BASELINE_SOURCE_GENERATION}" "${BASELINE_ARCHIVE_SHA256}" \
    "${SEALED_SOURCE_URI}" "${SEALED_SOURCE_GENERATION}" "${SEALED_ARCHIVE_SHA256}" \
    "${RELEASE_MANIFEST_SHA256}" >"${TEMP_DIR}/missing-config-confirmation.out" 2>&1; then
  fail "Candidate submission succeeded without confirming the exact build config."
fi
[[ ! -s "${GCLOUD_LOG}" ]] || fail "Candidate submission contacted Cloud Build before config confirmation."

SUBMIT_OUTPUT="$(
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" FAKE_GCLOUD_STATE="${STATE_FILE}" GCLOUD="${FAKE_GCLOUD}" \
  CONFIRM_CONFIG_SHA256="${CONFIG_SHA256}" \
    bash "${ROOT_DIR}/scripts/submit-cloud-run-history-hotfix-candidate.sh" \
      "${BASELINE_SOURCE_URI}" "${BASELINE_SOURCE_GENERATION}" "${BASELINE_ARCHIVE_SHA256}" \
      "${SEALED_SOURCE_URI}" "${SEALED_SOURCE_GENERATION}" "${SEALED_ARCHIVE_SHA256}" \
      "${RELEASE_MANIFEST_SHA256}"
)"
assert_contains "${SUBMIT_OUTPUT}" "candidate_release_gate=no_source_no_traffic"
assert_contains "${SUBMIT_OUTPUT}" "cloudbuild_config_sha256=${CONFIG_SHA256}"
SUBMIT_GCLOUD_CALL="$(<"${GCLOUD_LOG}")"
assert_contains "${SUBMIT_GCLOUD_CALL}" "builds submit --project=billbridge-c684f --region=global --no-source"
assert_not_contains "${SUBMIT_GCLOUD_CALL}" "--config=${ROOT_DIR}/cloudbuild.history-hotfix.yaml"
assert_contains "${SUBMIT_GCLOUD_CALL}" "_BASELINE_SOURCE_URI=${BASELINE_SOURCE_URI}"
assert_contains "${SUBMIT_GCLOUD_CALL}" "_SEALED_RELEASE_SOURCE_URI=${SEALED_SOURCE_URI}"

RELEASE_ID="01234567-89ab-cdef-0123-456789abcdef"
SHORT_RELEASE_ID="$(python3 -c 'import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode("ascii")).hexdigest()[:16])' "${RELEASE_ID}")"
SERVICE_NAME="readmate-api"
BASE_REVISION="readmate-api-00067-vaz"
REVISION_NAME="${SERVICE_NAME}-hist-${SHORT_RELEASE_ID}"
CANDIDATE_TAG="history-hotfix-${SHORT_RELEASE_ID}"
DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
IMAGE_TAG="us-central1-docker.pkg.dev/billbridge-c684f/readmate/readmate-api:history-hotfix-${RELEASE_ID}"
EXPECTED_IMAGE="us-central1-docker.pkg.dev/billbridge-c684f/readmate/readmate-api@${DIGEST}"
CANDIDATE_URL="https://${CANDIDATE_TAG}---readmate-api-example.a.run.app"

[[ "${SHORT_RELEASE_ID}" == "a23d006bb020a81d" ]] \
  || fail "Short release id derivation changed for the known Cloud Build id."
[[ "${CANDIDATE_TAG}" == "history-hotfix-a23d006bb020a81d" ]] \
  || fail "Candidate tag derivation changed for the known Cloud Build id."
[[ ${#CANDIDATE_TAG} -eq 31 ]] || fail "Candidate tag is not the expected bounded length."
[[ $(( ${#SERVICE_NAME} + ${#CANDIDATE_TAG} )) -eq 43 ]] \
  || fail "Combined service/tag length changed unexpectedly."
(( ${#SERVICE_NAME} + ${#CANDIDATE_TAG} <= 46 )) \
  || fail "Test candidate tag exceeds Cloud Run's combined service/tag limit."

ARTIFACT_JSON="$(printf '{"image_summary":{"digest":"%s"}}' "${DIGEST}")"
SERVICE_JSON_BEFORE="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestCreatedRevisionName":"%s","traffic":[{"revisionName":"readmate-api-00067-vaz","percent":100}]}}' "${BASE_REVISION}")"
SERVICE_JSON_AFTER="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestCreatedRevisionName":"%s","traffic":[{"revisionName":"readmate-api-00067-vaz","percent":100},{"revisionName":"%s","percent":0,"tag":"%s","url":"%s"}]}}' "${REVISION_NAME}" "${REVISION_NAME}" "${CANDIDATE_TAG}" "${CANDIDATE_URL}")"
BASE_REVISION_JSON="$(printf '{"metadata":{"name":"%s","annotations":{"autoscaling.knative.dev/maxScale":"3","run.googleapis.com/cloudsql-instances":"project:region:database","run.googleapis.com/operation-id":"old-operation","client.knative.dev/user-image":"old.example/image:tag"}},"spec":{"containerConcurrency":10,"timeoutSeconds":60,"serviceAccountName":"readmate-api@billbridge-c684f.iam.gserviceaccount.com","containers":[{"image":"old.example/image@sha256:old","ports":[{"containerPort":8080}],"resources":{"limits":{"cpu":"1","memory":"512Mi"}},"env":[{"name":"NODE_ENV","value":"production"},{"name":"DATABASE_URL","valueFrom":{"secretKeyRef":{"name":"database-url","key":"latest"}}}]}]},"status":{"conditions":[{"type":"Ready","status":"True"}]}}' "${BASE_REVISION}")"
CANDIDATE_REVISION_JSON="$(printf '{"metadata":{"name":"%s","annotations":{"autoscaling.knative.dev/maxScale":"3","run.googleapis.com/cloudsql-instances":"project:region:database","run.googleapis.com/operation-id":"new-operation","client.knative.dev/user-image":"%s"}},"spec":{"containerConcurrency":10,"timeoutSeconds":60,"serviceAccountName":"readmate-api@billbridge-c684f.iam.gserviceaccount.com","containers":[{"image":"%s","ports":[{"containerPort":8080}],"resources":{"limits":{"cpu":"1","memory":"512Mi"}},"env":[{"name":"NODE_ENV","value":"production"},{"name":"DATABASE_URL","valueFrom":{"secretKeyRef":{"name":"database-url","key":"latest"}}}]}]},"status":{"imageDigest":"%s","conditions":[{"type":"Ready","status":"True"}]}}' "${REVISION_NAME}" "${EXPECTED_IMAGE}" "${EXPECTED_IMAGE}" "${EXPECTED_IMAGE}")"

run_candidate() {
  local candidate_revision_json="$1"
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_ARTIFACT_JSON="${ARTIFACT_JSON}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_BASE_REVISION_NAME="${BASE_REVISION}" \
  FAKE_BASE_REVISION_JSON="${BASE_REVISION_JSON}" \
  FAKE_CANDIDATE_REVISION_JSON="${candidate_revision_json}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/deploy-cloud-run-history-hotfix-candidate.sh" \
    "${IMAGE_TAG}" \
    "${RELEASE_ID}"
}

CANDIDATE_OUTPUT="$(run_candidate "${CANDIDATE_REVISION_JSON}")"

assert_contains "${CANDIDATE_OUTPUT}" "history_hotfix_base_revision=${BASE_REVISION}"
assert_contains "${CANDIDATE_OUTPUT}" "history_hotfix_release_id=${RELEASE_ID}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_revision=${REVISION_NAME}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_tag=${CANDIDATE_TAG}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_image=${EXPECTED_IMAGE}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_traffic_percent=0"
assert_contains "${CANDIDATE_OUTPUT}" "database_schema_changes=skipped"
assert_contains "${CANDIDATE_OUTPUT}" "configuration_change_scope=image_revision_and_tag_only"
assert_contains "${CANDIDATE_OUTPUT}" "release_gate=no_traffic_no_promotion"

GCLOUD_CALLS="$(<"${GCLOUD_LOG}")"
DEPLOY_CALL="$(grep '^run deploy ' "${GCLOUD_LOG}")"
EXPECTED_DEPLOY_CALL="run deploy ${SERVICE_NAME} --project=billbridge-c684f --region=us-central1 --platform=managed --image=${EXPECTED_IMAGE} --no-traffic --revision-suffix=hist-${SHORT_RELEASE_ID} --tag=${CANDIDATE_TAG} --quiet --format=json"
[[ "${DEPLOY_CALL}" == "${EXPECTED_DEPLOY_CALL}" ]] || fail "History hotfix deploy command changed service configuration: ${DEPLOY_CALL}"
assert_not_contains "${GCLOUD_CALLS}" "update-traffic"
assert_not_contains "${GCLOUD_CALLS}" "prisma"

# A derived tag collision must fail closed before Cloud Run creates a revision.
: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
SERVICE_JSON_BEFORE_ORIGINAL="${SERVICE_JSON_BEFORE}"
SERVICE_JSON_BEFORE="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestCreatedRevisionName":"%s","traffic":[{"revisionName":"%s","percent":100},{"revisionName":"readmate-api-existing-candidate","percent":0,"tag":"%s","url":"%s"}]}}' "${BASE_REVISION}" "${BASE_REVISION}" "${CANDIDATE_TAG}" "${CANDIDATE_URL}")"
if run_candidate "${CANDIDATE_REVISION_JSON}" >"${TEMP_DIR}/candidate-tag-collision.out" 2>&1; then
  fail "History hotfix candidate reused an existing derived tag."
fi
assert_contains "$(<"${TEMP_DIR}/candidate-tag-collision.out")" "Refusing to reuse existing candidate tag ${CANDIDATE_TAG}"
assert_not_contains "$(<"${GCLOUD_LOG}")" "run deploy"
SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE_ORIGINAL}"

# A candidate whose environment differs from the baseline must fail closed.
: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
DRIFTED_REVISION_JSON="${CANDIDATE_REVISION_JSON/\"NODE_ENV\",\"value\":\"production\"/\"NODE_ENV\",\"value\":\"drifted\"}"
if run_candidate "${DRIFTED_REVISION_JSON}" >"${TEMP_DIR}/config-drift.out" 2>&1; then
  fail "History hotfix candidate accepted changed revision configuration."
fi
assert_contains "$(<"${TEMP_DIR}/config-drift.out")" "configuration differs from baseline"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"

# Configuration-relevant revision annotation drift must fail closed even when
# the candidate spec itself remains byte-for-byte equivalent.
: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
ANNOTATION_DRIFT_REVISION_JSON="${CANDIDATE_REVISION_JSON/\"autoscaling.knative.dev\/maxScale\":\"3\"/\"autoscaling.knative.dev\/maxScale\":\"99\"}"
if run_candidate "${ANNOTATION_DRIFT_REVISION_JSON}" >"${TEMP_DIR}/annotation-drift.out" 2>&1; then
  fail "History hotfix candidate accepted configuration annotation drift."
fi
assert_contains "$(<"${TEMP_DIR}/annotation-drift.out")" "configuration differs from baseline"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"

# A matching spec image must not hide a contradictory resolved runtime digest.
: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
CONTRADICTORY_IMAGE="us-central1-docker.pkg.dev/billbridge-c684f/readmate/readmate-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CONTRADICTORY_DIGEST_REVISION_JSON="$(python3 -c 'import json, sys; value=json.loads(sys.argv[1]); value["status"]["imageDigest"]=sys.argv[2]; print(json.dumps(value, separators=(",", ":")))' "${CANDIDATE_REVISION_JSON}" "${CONTRADICTORY_IMAGE}")"
if run_candidate "${CONTRADICTORY_DIGEST_REVISION_JSON}" >"${TEMP_DIR}/contradictory-digest.out" 2>&1; then
  fail "History hotfix candidate accepted contradictory resolved image evidence."
fi
assert_contains "$(<"${TEMP_DIR}/contradictory-digest.out")" "resolved image digest does not match"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"

# Any change to existing production traffic must also fail closed.
: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
SERVICE_JSON_AFTER_ORIGINAL="${SERVICE_JSON_AFTER}"
SERVICE_JSON_AFTER="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestCreatedRevisionName":"%s","traffic":[{"revisionName":"readmate-api-00067-vaz","percent":90},{"revisionName":"readmate-api-unapproved","percent":10},{"revisionName":"%s","percent":0,"tag":"%s","url":"%s"}]}}' "${REVISION_NAME}" "${REVISION_NAME}" "${CANDIDATE_TAG}" "${CANDIDATE_URL}")"
if run_candidate "${CANDIDATE_REVISION_JSON}" >"${TEMP_DIR}/traffic-drift.out" 2>&1; then
  fail "History hotfix candidate accepted changed production traffic."
fi
assert_contains "$(<"${TEMP_DIR}/traffic-drift.out")" "production traffic allocations changed"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"
SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER_ORIGINAL}"

# A newer unpromoted candidate must never become the inherited configuration
# baseline. This guard must stop before the deploy command is attempted.
: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
SERVICE_JSON_BEFORE_ORIGINAL="${SERVICE_JSON_BEFORE}"
SERVICE_JSON_BEFORE="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestCreatedRevisionName":"readmate-api-unpromoted","traffic":[{"revisionName":"%s","percent":100},{"revisionName":"readmate-api-unpromoted","percent":0,"tag":"older-candidate","url":"https://older-candidate.example.run.app"}]}}' "${BASE_REVISION}")"
if run_candidate "${CANDIDATE_REVISION_JSON}" >"${TEMP_DIR}/unpromoted-baseline.out" 2>&1; then
  fail "History hotfix candidate inherited an unpromoted latest-created revision."
fi
assert_contains "$(<"${TEMP_DIR}/unpromoted-baseline.out")" "is not the 100% live revision"
assert_not_contains "$(<"${GCLOUD_LOG}")" "run deploy"
SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE_ORIGINAL}"

# Promotion is a separate action and must validate exact confirmation before
# making even a read-only Cloud Run request.
BASE_CONFIG_DIGEST="$(printf '%s\n' "${CANDIDATE_OUTPUT}" | awk -F= '$1 == "history_hotfix_base_config_sha256" {print $2}')"
SERVICE_JSON_PROMOTED="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestCreatedRevisionName":"%s","traffic":[{"revisionName":"%s","percent":100,"tag":"%s","url":"%s"}]}}' "${REVISION_NAME}" "${REVISION_NAME}" "${CANDIDATE_TAG}" "${CANDIDATE_URL}")"
V2_SERVICE_NAME="projects/billbridge-c684f/locations/us-central1/services/readmate-api"
V2_SERVICE_JSON="$(printf '{"name":"%s","generation":"68","observedGeneration":"68","etag":"etag-68","reconciling":false,"latestCreatedRevision":"%s/revisions/%s","latestReadyRevision":"%s/revisions/%s","traffic":[{"type":"TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION","revision":"%s","percent":100},{"type":"TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION","revision":"readmate-api-00055-9fs","tag":"supabase-rotation"},{"type":"TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION","revision":"%s","tag":"%s"}],"terminalCondition":{"state":"CONDITION_SUCCEEDED"}}' "${V2_SERVICE_NAME}" "${V2_SERVICE_NAME}" "${REVISION_NAME}" "${V2_SERVICE_NAME}" "${REVISION_NAME}" "${BASE_REVISION}" "${REVISION_NAME}" "${CANDIDATE_TAG}")"
V2_BODY_LOG="${TEMP_DIR}/v2-promotion-body.json"

run_promotion() {
  local candidate_revision_json="${1:-${CANDIDATE_REVISION_JSON}}"
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_SERVICE_JSON_PROMOTED="${SERVICE_JSON_PROMOTED}" \
  FAKE_BASE_REVISION_NAME="${BASE_REVISION}" \
  FAKE_BASE_REVISION_JSON="${BASE_REVISION_JSON}" \
  FAKE_CANDIDATE_REVISION_JSON="${candidate_revision_json}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  FAKE_CURL_SERVICE_V2_JSON="${V2_SERVICE_JSON}" \
  FAKE_CURL_BODY_LOG="${V2_BODY_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/promote-cloud-run-history-hotfix-candidate.sh" \
    "${REVISION_NAME}" \
    "${CANDIDATE_TAG}" \
    "${EXPECTED_IMAGE}" \
    "${BASE_REVISION}" \
    "${BASE_CONFIG_DIGEST}"
}

: >"${GCLOUD_LOG}"
: >"${CURL_LOG}"
: >"${STATE_FILE}"
printf 'deployed\n' >"${STATE_FILE}"
if run_promotion >"${TEMP_DIR}/missing-promotion-confirmation.out" 2>&1; then
  fail "History hotfix promotion succeeded without CONFIRM_REVISION."
fi
[[ ! -s "${GCLOUD_LOG}" ]] || fail "Promotion contacted Cloud Run before validating CONFIRM_REVISION."

: >"${GCLOUD_LOG}"
: >"${CURL_LOG}"
: >"${STATE_FILE}"
printf 'deployed\n' >"${STATE_FILE}"
if CONFIRM_REVISION="${REVISION_NAME}" run_promotion "${ANNOTATION_DRIFT_REVISION_JSON}" >"${TEMP_DIR}/promotion-annotation-drift.out" 2>&1; then
  fail "History hotfix promotion accepted configuration annotation drift."
fi
assert_contains "$(<"${TEMP_DIR}/promotion-annotation-drift.out")" "configuration differs from approved baseline"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"

: >"${GCLOUD_LOG}"
: >"${CURL_LOG}"
: >"${STATE_FILE}"
printf 'deployed\n' >"${STATE_FILE}"
if CONFIRM_REVISION="${REVISION_NAME}" run_promotion "${CONTRADICTORY_DIGEST_REVISION_JSON}" >"${TEMP_DIR}/promotion-contradictory-digest.out" 2>&1; then
  fail "History hotfix promotion accepted contradictory resolved image evidence."
fi
assert_contains "$(<"${TEMP_DIR}/promotion-contradictory-digest.out")" "resolved image digest does not match"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"

# The final v2 snapshot must contain an etag before any traffic PATCH.
: >"${GCLOUD_LOG}"
: >"${CURL_LOG}"
: >"${STATE_FILE}"
printf 'deployed\n' >"${STATE_FILE}"
V2_SERVICE_JSON_ORIGINAL="${V2_SERVICE_JSON}"
V2_SERVICE_JSON="$(python3 -c 'import json, sys; value=json.loads(sys.argv[1]); value.pop("etag", None); print(json.dumps(value, separators=(",", ":")))' "${V2_SERVICE_JSON_ORIGINAL}")"
if CONFIRM_REVISION="${REVISION_NAME}" run_promotion >"${TEMP_DIR}/promotion-missing-etag.out" 2>&1; then
  fail "History hotfix promotion accepted a Cloud Run service without an etag."
fi
assert_contains "$(<"${TEMP_DIR}/promotion-missing-etag.out")" "did not provide a usable etag"
assert_not_contains "$(<"${CURL_LOG}")" "--request PATCH"
V2_SERVICE_JSON="${V2_SERVICE_JSON_ORIGINAL}"

# An etag conflict is fail-closed and must never be retried in place.
: >"${GCLOUD_LOG}"
: >"${CURL_LOG}"
: >"${STATE_FILE}"
printf 'deployed\n' >"${STATE_FILE}"
if FAKE_CURL_PATCH_HTTP_STATUS=412 CONFIRM_REVISION="${REVISION_NAME}" run_promotion >"${TEMP_DIR}/promotion-stale-etag.out" 2>&1; then
  fail "History hotfix promotion ignored an etag conflict."
fi
assert_contains "$(<"${TEMP_DIR}/promotion-stale-etag.out")" "do not retry without a full preflight"
[[ "$(grep -c -- '--request PATCH' "${CURL_LOG}")" == "1" ]] || fail "Etag conflict was retried."
[[ "$(<"${STATE_FILE}")" == "deployed" ]] || fail "Etag conflict changed fake production traffic."

: >"${GCLOUD_LOG}"
: >"${CURL_LOG}"
: >"${STATE_FILE}"
printf 'deployed\n' >"${STATE_FILE}"
PROMOTION_OUTPUT="$(CONFIRM_REVISION="${REVISION_NAME}" run_promotion)"
assert_contains "${PROMOTION_OUTPUT}" "promoted_revision=${REVISION_NAME}"
assert_contains "${PROMOTION_OUTPUT}" "promoted_from_revision=${BASE_REVISION}"
assert_contains "${PROMOTION_OUTPUT}" "approved_base_config_sha256=${BASE_CONFIG_DIGEST}"
assert_contains "${PROMOTION_OUTPUT}" "promotion_precondition=cloud-run-v2-etag"
assert_contains "${PROMOTION_OUTPUT}" "promotion_service_generation=68"
assert_contains "${PROMOTION_OUTPUT}" "promoted_traffic_percent=100"
assert_contains "${PROMOTION_OUTPUT}" "project=billbridge-c684f"
assert_contains "${PROMOTION_OUTPUT}" "region=us-central1"
assert_contains "${PROMOTION_OUTPUT}" "service=readmate-api"

PROMOTION_GCLOUD_CALLS="$(<"${GCLOUD_LOG}")"
assert_contains "${PROMOTION_GCLOUD_CALLS}" "auth print-access-token --quiet"
assert_not_contains "${PROMOTION_GCLOUD_CALLS}" "run services update-traffic"
assert_not_contains "${PROMOTION_GCLOUD_CALLS}" "--to-latest"
assert_not_contains "${PROMOTION_GCLOUD_CALLS}" "latestReadyRevisionName"

PROMOTION_CURL_CALLS="$(<"${CURL_LOG}")"
assert_contains "${PROMOTION_CURL_CALLS}" "--request PATCH"
assert_contains "${PROMOTION_CURL_CALLS}" "${V2_SERVICE_NAME}?updateMask=traffic"
python3 -c '
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))
assert body["name"] == sys.argv[2]
assert body["etag"] == "etag-68"
assert body["traffic"][0] == {
    "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
    "revision": sys.argv[3],
    "percent": 100,
}
assert {entry.get("tag") for entry in body["traffic"][1:]} == {"supabase-rotation", sys.argv[4]}
assert all("percent" not in entry for entry in body["traffic"][1:])
' "${V2_BODY_LOG}" "${V2_SERVICE_NAME}" "${REVISION_NAME}" "${CANDIDATE_TAG}"

printf 'cloud-run history hotfix pipeline regression test: PASS\n'
