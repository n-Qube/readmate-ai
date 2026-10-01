#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

FAKE_GCLOUD="${ROOT_DIR}/scripts/tests/fixtures/fake-gcloud.sh"
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
  "${ROOT_DIR}/scripts/preflight-cloud-run-release.sh" \
  "${ROOT_DIR}/scripts/deploy-cloud-run-candidate.sh" \
  "${ROOT_DIR}/scripts/promote-cloud-run-candidate.sh" \
  "${ROOT_DIR}/scripts/deploy-cloud-run.sh"

CLOUDBUILD_CONTENT="$(<"${ROOT_DIR}/cloudbuild.yaml")"
CANDIDATE_SCRIPT_CONTENT="$(<"${ROOT_DIR}/scripts/deploy-cloud-run-candidate.sh")"
PROMOTION_SCRIPT_CONTENT="$(<"${ROOT_DIR}/scripts/promote-cloud-run-candidate.sh")"
assert_contains "${CLOUDBUILD_CONTENT}" "scripts/deploy-cloud-run-candidate.sh"
assert_contains "${CLOUDBUILD_CONTENT}" "scripts/preflight-cloud-run-release.sh"
assert_not_contains "${CLOUDBUILD_CONTENT}" "scripts/promote-cloud-run-candidate.sh"
assert_contains "${CLOUDBUILD_CONTENT}" '_ENABLE_REVENUECAT: "false"'
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" "--no-traffic"
assert_contains "${CANDIDATE_SCRIPT_CONTENT}" "--revision-suffix"
assert_not_contains "${CANDIDATE_SCRIPT_CONTENT}" "update-traffic"
assert_not_contains "${CANDIDATE_SCRIPT_CONTENT}" "latestReadyRevisionName"
assert_contains "${PROMOTION_SCRIPT_CONTENT}" '--to-revisions "${REVISION_NAME}=100"'
assert_not_contains "${PROMOTION_SCRIPT_CONTENT}" "latestReadyRevisionName"
assert_not_contains "${PROMOTION_SCRIPT_CONTENT}" "--to-latest"

PREFLIGHT_LINE="$(awk '/scripts\/preflight-cloud-run-release\.sh/ { print NR; exit }' "${ROOT_DIR}/cloudbuild.yaml")"
MIGRATION_LINE="$(awk '/docker run --rm -e DATABASE_URL/ { print NR; exit }' "${ROOT_DIR}/cloudbuild.yaml")"
[[ -n "${PREFLIGHT_LINE}" && -n "${MIGRATION_LINE}" && "${PREFLIGHT_LINE}" -lt "${MIGRATION_LINE}" ]] || \
  fail "Release preflight must run before the database migration."

PREFLIGHT_OUTPUT="$(
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" \
  bash "${ROOT_DIR}/scripts/preflight-cloud-run-release.sh" \
    project-id \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    false
)"
assert_contains "${PREFLIGHT_OUTPUT}" "release_preflight=passed"
assert_contains "${PREFLIGHT_OUTPUT}" "preflight_revenuecat_enabled=false"
GCLOUD_CALLS="$(<"${GCLOUD_LOG}")"
assert_contains "${GCLOUD_CALLS}" "--secret=readmate-database-migration-url"
assert_contains "${GCLOUD_CALLS}" "--secret=readmate-webmcp-audit-digest-key"
assert_not_contains "${GCLOUD_CALLS}" "--secret=readmate-revenuecat-secret-api-key"

: >"${GCLOUD_LOG}"
PREFLIGHT_REVENUECAT_OUTPUT="$(
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" \
  bash "${ROOT_DIR}/scripts/preflight-cloud-run-release.sh" \
    project-id \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    true
)"
assert_contains "${PREFLIGHT_REVENUECAT_OUTPUT}" "preflight_revenuecat_enabled=true"
assert_contains "$(<"${GCLOUD_LOG}")" "--secret=readmate-revenuecat-secret-api-key"

: >"${GCLOUD_LOG}"
if FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" \
  bash "${ROOT_DIR}/scripts/preflight-cloud-run-release.sh" \
    project-id \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com/path \
    false \
    >"${TEMP_DIR}/preflight-invalid-origin.out" 2>&1; then
  fail "Release preflight accepted an invalid web origin."
fi
[[ ! -s "${GCLOUD_LOG}" ]] || fail "Release preflight contacted Secret Manager before validating origins."

: >"${GCLOUD_LOG}"
if FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" \
  bash "${ROOT_DIR}/scripts/preflight-cloud-run-release.sh" \
    project-id \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    yes \
    >"${TEMP_DIR}/preflight-invalid-flag.out" 2>&1; then
  fail "Release preflight accepted an invalid RevenueCat opt-in value."
fi
[[ ! -s "${GCLOUD_LOG}" ]] || fail "Release preflight contacted Secret Manager before validating the RevenueCat opt-in."

: >"${GCLOUD_LOG}"
if FAKE_UNAVAILABLE_SECRET=readmate-webmcp-audit-digest-key \
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" \
  bash "${ROOT_DIR}/scripts/preflight-cloud-run-release.sh" \
    project-id \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    false \
    >"${TEMP_DIR}/preflight-missing-webmcp.out" 2>&1; then
  fail "Release preflight accepted a missing WebMCP audit digest secret version."
fi
assert_contains "$(<"${TEMP_DIR}/preflight-missing-webmcp.out")" "readmate-webmcp-audit-digest-key:latest"

: >"${GCLOUD_LOG}"
if FAKE_DISABLED_SECRET=readmate-webmcp-audit-digest-key \
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" \
  bash "${ROOT_DIR}/scripts/preflight-cloud-run-release.sh" \
    project-id \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    false \
    >"${TEMP_DIR}/preflight-disabled-webmcp.out" 2>&1; then
  fail "Release preflight accepted a disabled WebMCP audit digest secret version."
fi
assert_contains "$(<"${TEMP_DIR}/preflight-disabled-webmcp.out")" "Required secret version is not enabled"

: >"${GCLOUD_LOG}"

RELEASE_ID="01234567-89ab-cdef-0123-456789abcdef"
SHORT_RELEASE_ID="$(python3 -c 'import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode("ascii")).hexdigest()[:16])' "${RELEASE_ID}")"
SERVICE_NAME="readmate-api"
REVISION_NAME="${SERVICE_NAME}-build-${SHORT_RELEASE_ID}"
CANDIDATE_TAG="candidate-${SHORT_RELEASE_ID}"
UNBOUNDED_CANDIDATE_TAG="candidate-${RELEASE_ID}"
DIGEST="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
IMAGE_TAG="us-central1-docker.pkg.dev/project-id/readmate/readmate-api:${RELEASE_ID}"
EXPECTED_IMAGE="us-central1-docker.pkg.dev/project-id/readmate/readmate-api@${DIGEST}"
CANDIDATE_URL="https://${CANDIDATE_TAG}---readmate-api-example.a.run.app"
CONFIRM_DESTINATION_VALUE="project-id/us-central1/${SERVICE_NAME}/${REVISION_NAME}"

[[ "${SHORT_RELEASE_ID}" == "a23d006bb020a81d" ]] \
  || fail "Short release id derivation changed for the known Cloud Build UUID."
(( ${#SERVICE_NAME} + ${#UNBOUNDED_CANDIDATE_TAG} > 46 )) \
  || fail "The regression fixture no longer demonstrates the unbounded UUID tag failure."
[[ "${CANDIDATE_TAG}" == "candidate-a23d006bb020a81d" ]] \
  || fail "Candidate tag derivation changed for the known Cloud Build UUID."
[[ ${#CANDIDATE_TAG} -eq 26 ]] || fail "Candidate tag is not the expected bounded length."
[[ "${REVISION_NAME}" == "readmate-api-build-a23d006bb020a81d" ]] \
  || fail "Revision name derivation changed for the known Cloud Build UUID."
[[ ${#REVISION_NAME} -eq 35 ]] || fail "Revision name is not the expected bounded length."
[[ $(( ${#SERVICE_NAME} + ${#CANDIDATE_TAG} )) -eq 38 ]] \
  || fail "Combined service/tag length changed unexpectedly."
(( ${#SERVICE_NAME} + ${#CANDIDATE_TAG} <= 46 )) \
  || fail "Derived candidate tag exceeds Cloud Run's combined service/tag limit."

ARTIFACT_JSON="$(printf '{"image_summary":{"digest":"%s"}}' "${DIGEST}")"
SERVICE_JSON_BEFORE="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestReadyRevisionName":"readmate-api-build-unrelated","traffic":[{"revisionName":"readmate-api-build-live","percent":100},{"revisionName":"%s","percent":0,"tag":"%s","url":"%s"}]}}' "${REVISION_NAME}" "${CANDIDATE_TAG}" "${CANDIDATE_URL}")"
SERVICE_JSON_AFTER="$(printf '{"status":{"url":"https://readmate-api-example.a.run.app","latestReadyRevisionName":"readmate-api-build-another-unrelated","traffic":[{"revisionName":"%s","percent":100,"tag":"%s","url":"%s"}]}}' "${REVISION_NAME}" "${CANDIDATE_TAG}" "${CANDIDATE_URL}")"
REVISION_JSON="$(printf '{"metadata":{"name":"%s"},"spec":{"containers":[{"image":"%s"}]},"status":{"imageDigest":"%s","conditions":[{"type":"Ready","status":"True"}]}}' "${REVISION_NAME}" "${EXPECTED_IMAGE}" "${EXPECTED_IMAGE}")"
CONTRADICTORY_IMAGE="us-central1-docker.pkg.dev/project-id/readmate/readmate-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CONTRADICTORY_REVISION_JSON="$(python3 -c 'import json, sys; value=json.loads(sys.argv[1]); value["status"]["imageDigest"]=sys.argv[2]; print(json.dumps(value, separators=(",", ":")))' "${REVISION_JSON}" "${CONTRADICTORY_IMAGE}")"

CANDIDATE_OUTPUT="$(
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_ARTIFACT_JSON="${ARTIFACT_JSON}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_REVISION_JSON="${REVISION_JSON}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/deploy-cloud-run-candidate.sh" \
    "${IMAGE_TAG}" \
    us-central1 \
    "${SERVICE_NAME}" \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    project-id \
    "${RELEASE_ID}"
)"

assert_contains "${CANDIDATE_OUTPUT}" "candidate_revision=${REVISION_NAME}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_release_id=${RELEASE_ID}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_tag=${CANDIDATE_TAG}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_image=${EXPECTED_IMAGE}"
assert_contains "${CANDIDATE_OUTPUT}" "candidate_traffic_percent=0"
assert_contains "${CANDIDATE_OUTPUT}" "release_gate=manual_exact_revision_promotion_required"

GCLOUD_CALLS="$(<"${GCLOUD_LOG}")"
assert_contains "${GCLOUD_CALLS}" "artifacts docker images describe ${IMAGE_TAG}"
assert_contains "${GCLOUD_CALLS}" "run deploy ${SERVICE_NAME}"
assert_contains "${GCLOUD_CALLS}" "--image ${EXPECTED_IMAGE}"
assert_contains "${GCLOUD_CALLS}" "--revision-suffix build-${SHORT_RELEASE_ID}"
assert_contains "${GCLOUD_CALLS}" "--tag ${CANDIDATE_TAG}"
assert_not_contains "${GCLOUD_CALLS}" "update-traffic"
assert_not_contains "${GCLOUD_CALLS}" "readmate-api-build-unrelated=100"
assert_contains "${GCLOUD_CALLS}" "--remove-secrets=REVENUECAT_SECRET_API_KEY"
assert_contains "${GCLOUD_CALLS}" "CARTESIA_API_KEY"
assert_contains "${GCLOUD_CALLS}" "CARTESIA_VOICE_ID,CARTESIA_MODEL_ID"
assert_not_contains "${GCLOUD_CALLS}" "REVENUECAT_SECRET_API_KEY=readmate-revenuecat-secret-api-key:latest"
assert_not_contains "${GCLOUD_CALLS}" "REVENUECAT_ENTITLEMENT_ID=premium"

# Unresolvable versions keep ":latest" and warn instead of failing.
assert_contains "${CANDIDATE_OUTPUT}" "secret_pin=readmate-clerk-secret-key:latest (WARNING"

: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
PINNED_OUTPUT="$(
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_ARTIFACT_JSON="${ARTIFACT_JSON}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_REVISION_JSON="${REVISION_JSON}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  FAKE_SECRET_VERSION=7 \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/deploy-cloud-run-candidate.sh" \
    "${IMAGE_TAG}" \
    us-central1 \
    "${SERVICE_NAME}" \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    project-id \
    "${RELEASE_ID}"
)"
assert_contains "${PINNED_OUTPUT}" "secret_pin=readmate-clerk-secret-key:7"
GCLOUD_CALLS="$(<"${GCLOUD_LOG}")"
assert_contains "${GCLOUD_CALLS}" "CLERK_SECRET_KEY=readmate-clerk-secret-key:7"
assert_contains "${GCLOUD_CALLS}" "DATABASE_URL=readmate-database-app-url:7"
assert_not_contains "${GCLOUD_CALLS}" "readmate-clerk-secret-key:latest"

: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
CANDIDATE_REVENUECAT_OUTPUT="$(
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_ARTIFACT_JSON="${ARTIFACT_JSON}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_REVISION_JSON="${REVISION_JSON}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/deploy-cloud-run-candidate.sh" \
    "${IMAGE_TAG}" \
    us-central1 \
    "${SERVICE_NAME}" \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com \
    project-id \
    "${RELEASE_ID}" \
    true
)"
assert_contains "${CANDIDATE_REVENUECAT_OUTPUT}" "candidate_revision=${REVISION_NAME}"
GCLOUD_CALLS="$(<"${GCLOUD_LOG}")"
assert_contains "${GCLOUD_CALLS}" "REVENUECAT_SECRET_API_KEY=readmate-revenuecat-secret-api-key:latest"
assert_contains "${GCLOUD_CALLS}" "REVENUECAT_ENTITLEMENT_ID=premium"
assert_not_contains "${GCLOUD_CALLS}" "--remove-secrets=REVENUECAT_SECRET_API_KEY"

: >"${GCLOUD_LOG}"
if FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/deploy-cloud-run-candidate.sh" \
    "${IMAGE_TAG}" us-central1 "${SERVICE_NAME}" \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com project-id "${RELEASE_ID}" yes \
    >"${TEMP_DIR}/candidate-invalid-revenuecat-flag.out" 2>&1; then
  fail "Candidate deployment accepted an invalid RevenueCat opt-in value."
fi
[[ ! -s "${GCLOUD_LOG}" ]] || fail "Candidate deployment contacted Google Cloud before validating the RevenueCat opt-in."

: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
if FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_ARTIFACT_JSON="${ARTIFACT_JSON}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_REVISION_JSON="${CONTRADICTORY_REVISION_JSON}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/deploy-cloud-run-candidate.sh" \
    "${IMAGE_TAG}" us-central1 "${SERVICE_NAME}" \
    chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    https://app.example.com project-id "${RELEASE_ID}" \
    >"${TEMP_DIR}/candidate-contradictory-digest.out" 2>&1; then
  fail "Candidate deployment accepted contradictory resolved image evidence."
fi
assert_contains "$(<"${TEMP_DIR}/candidate-contradictory-digest.out")" "resolved image digest does not match"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"

: >"${GCLOUD_LOG}"
if FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_REVISION_JSON="${REVISION_JSON}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/promote-cloud-run-candidate.sh" \
    "${REVISION_NAME}" "${CANDIDATE_TAG}" "${EXPECTED_IMAGE}" us-central1 "${SERVICE_NAME}" project-id \
    >"${TEMP_DIR}/missing-confirmation.out" 2>&1; then
  fail "Promotion succeeded without exact CONFIRM_REVISION authorization."
fi
[[ ! -s "${GCLOUD_LOG}" ]] || fail "Promotion contacted Cloud Run before validating CONFIRM_REVISION."

: >"${GCLOUD_LOG}"
if CONFIRM_REVISION="${REVISION_NAME}" CONFIRM_DESTINATION="wrong-project/us-central1/${SERVICE_NAME}/${REVISION_NAME}" \
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" FAKE_GCLOUD_STATE="${STATE_FILE}" \
  GCLOUD="${FAKE_GCLOUD}" CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/promote-cloud-run-candidate.sh" \
    "${REVISION_NAME}" "${CANDIDATE_TAG}" "${EXPECTED_IMAGE}" us-central1 "${SERVICE_NAME}" project-id \
    >"${TEMP_DIR}/wrong-destination-confirmation.out" 2>&1; then
  fail "Promotion accepted confirmation for a different production destination."
fi
[[ ! -s "${GCLOUD_LOG}" ]] || fail "Promotion contacted Cloud Run before validating CONFIRM_DESTINATION."

: >"${GCLOUD_LOG}"
: >"${STATE_FILE}"
if CONFIRM_REVISION="${REVISION_NAME}" \
  CONFIRM_DESTINATION="${CONFIRM_DESTINATION_VALUE}" \
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_REVISION_JSON="${CONTRADICTORY_REVISION_JSON}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/promote-cloud-run-candidate.sh" \
    "${REVISION_NAME}" "${CANDIDATE_TAG}" "${EXPECTED_IMAGE}" us-central1 "${SERVICE_NAME}" project-id \
    >"${TEMP_DIR}/promotion-contradictory-digest.out" 2>&1; then
  fail "Promotion accepted contradictory resolved image evidence."
fi
assert_contains "$(<"${TEMP_DIR}/promotion-contradictory-digest.out")" "resolved image digest does not match"
assert_not_contains "$(<"${GCLOUD_LOG}")" "update-traffic"

: >"${STATE_FILE}"
PROMOTION_OUTPUT="$(
  CONFIRM_REVISION="${REVISION_NAME}" \
  CONFIRM_DESTINATION="${CONFIRM_DESTINATION_VALUE}" \
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_SERVICE_JSON_BEFORE="${SERVICE_JSON_BEFORE}" \
  FAKE_SERVICE_JSON_AFTER="${SERVICE_JSON_AFTER}" \
  FAKE_REVISION_JSON="${REVISION_JSON}" \
  FAKE_CURL_LOG="${CURL_LOG}" \
  GCLOUD="${FAKE_GCLOUD}" \
  CURL="${FAKE_CURL}" \
  bash "${ROOT_DIR}/scripts/promote-cloud-run-candidate.sh" \
    "${REVISION_NAME}" "${CANDIDATE_TAG}" "${EXPECTED_IMAGE}" us-central1 "${SERVICE_NAME}" project-id
)"

assert_contains "${PROMOTION_OUTPUT}" "promoted_revision=${REVISION_NAME}"
assert_contains "${PROMOTION_OUTPUT}" "promoted_image=${EXPECTED_IMAGE}"
assert_contains "${PROMOTION_OUTPUT}" "promoted_traffic_percent=100"

GCLOUD_CALLS="$(<"${GCLOUD_LOG}")"
assert_contains "${GCLOUD_CALLS}" "run services update-traffic ${SERVICE_NAME}"
assert_contains "${GCLOUD_CALLS}" "--to-revisions ${REVISION_NAME}=100"
assert_not_contains "${GCLOUD_CALLS}" "--to-latest"
assert_not_contains "${GCLOUD_CALLS}" "readmate-api-build-unrelated=100"
assert_not_contains "${GCLOUD_CALLS}" "readmate-api-build-another-unrelated=100"

printf 'cloud-run release pipeline regression test: PASS\n'
