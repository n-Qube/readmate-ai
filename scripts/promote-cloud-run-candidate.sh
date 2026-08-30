#!/usr/bin/env bash
set -euo pipefail

REVISION_NAME="${1:?exact candidate revision is required}"
CANDIDATE_TAG="${2:?candidate tag is required}"
EXPECTED_IMAGE="${3:?immutable candidate image is required}"
REGION="${4:?region is required}"
SERVICE_NAME="${5:?service name is required}"
PROJECT_ID="${6:?project id is required}"

GCLOUD="${GCLOUD:-gcloud}"
CURL="${CURL:-curl}"
PYTHON="${PYTHON:-python3}"

fail() {
  echo "$*" >&2
  exit 1
}

candidate_record() {
  local service_json="$1"
  local candidate_tag="$2"

  "${PYTHON}" -c '
import json
import sys

service = json.load(sys.stdin)
tag = sys.argv[1]
traffic = service.get("status", {}).get("traffic", [])
matches = [item for item in traffic if item.get("tag") == tag]
if len(matches) != 1:
    raise SystemExit(f"expected exactly one traffic target for tag {tag!r}, found {len(matches)}")
target = matches[0]
revision = target.get("revisionName") or "-"
url = target.get("url") or "-"
revision_percent = sum(int(item.get("percent") or 0) for item in traffic if item.get("revisionName") == revision)
other_percent = sum(int(item.get("percent") or 0) for item in traffic if item.get("revisionName") != revision)
service_url = service.get("status", {}).get("url") or "-"
print(f"{revision}\t{url}\t{revision_percent}\t{other_percent}\t{service_url}")
' "${candidate_tag}" <<<"${service_json}"
}

revision_record() {
  local revision_json="$1"

  "${PYTHON}" -c '
import json
import sys

revision = json.load(sys.stdin)
containers = revision.get("spec", {}).get("containers", [])
spec_image = containers[0].get("image", "") if containers else ""
digest_image = revision.get("status", {}).get("imageDigest", "")
ready = any(
    condition.get("type") == "Ready" and condition.get("status") == "True"
    for condition in revision.get("status", {}).get("conditions", [])
)
print("\t".join([
    revision.get("metadata", {}).get("name") or "-",
    spec_image or "-",
    digest_image or "-",
    "true" if ready else "false",
]))
' <<<"${revision_json}"
}

if [[ ! "${SERVICE_NAME}" =~ ^[a-z]([-a-z0-9]*[a-z0-9])?$ ]]; then
  fail "SERVICE_NAME must be a lowercase Cloud Run service name."
fi

if [[ ! "${PROJECT_ID}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  fail "PROJECT_ID must be a valid Google Cloud project id."
fi

if [[ ! "${REGION}" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ ]]; then
  fail "REGION must be a lowercase Google Cloud region."
fi

if [[ "${REVISION_NAME}" != "${SERVICE_NAME}-"* ]]; then
  fail "Revision ${REVISION_NAME} does not belong to service ${SERVICE_NAME}."
fi

if [[ ! "${CANDIDATE_TAG}" =~ ^candidate-[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
  fail "CANDIDATE_TAG must be the unique candidate tag emitted by the candidate build."
fi

EXPECTED_DIGEST="${EXPECTED_IMAGE##*@}"
if [[ "${EXPECTED_IMAGE}" != *@sha256:* || ! "${EXPECTED_DIGEST}" =~ ^sha256:[0-9a-f]+$ ]] || [[ ${#EXPECTED_DIGEST} -ne 71 ]]; then
  fail "EXPECTED_IMAGE must be the immutable image@sha256 digest emitted by the candidate build."
fi

EXPECTED_IMAGE_RESOURCE="${REGION}-docker.pkg.dev/${PROJECT_ID}/readmate/readmate-api@${EXPECTED_DIGEST}"
if [[ "${EXPECTED_IMAGE}" != "${EXPECTED_IMAGE_RESOURCE}" ]]; then
  fail "EXPECTED_IMAGE must use the pinned ReadMate API repository in ${PROJECT_ID}/${REGION}."
fi

if [[ "${CONFIRM_REVISION:-}" != "${REVISION_NAME}" ]]; then
  fail "Set CONFIRM_REVISION to the exact revision name ${REVISION_NAME} to authorize production traffic promotion."
fi

EXPECTED_DESTINATION="${PROJECT_ID}/${REGION}/${SERVICE_NAME}/${REVISION_NAME}"
if [[ "${CONFIRM_DESTINATION:-}" != "${EXPECTED_DESTINATION}" ]]; then
  fail "Set CONFIRM_DESTINATION to ${EXPECTED_DESTINATION} to authorize this exact production destination."
fi

SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
if ! CANDIDATE_DETAILS="$(candidate_record "${SERVICE_JSON}" "${CANDIDATE_TAG}")"; then
  fail "Cloud Run did not report one unambiguous target for ${CANDIDATE_TAG}."
fi
IFS=$'\t' read -r TAGGED_REVISION CANDIDATE_URL CANDIDATE_TRAFFIC_PERCENT OTHER_TRAFFIC_PERCENT SERVICE_URL <<<"${CANDIDATE_DETAILS}"

if [[ "${TAGGED_REVISION}" != "${REVISION_NAME}" ]]; then
  fail "Candidate tag ${CANDIDATE_TAG} points to ${TAGGED_REVISION}, not approved revision ${REVISION_NAME}."
fi

if [[ "${CANDIDATE_URL}" == "-" || "${CANDIDATE_URL}" != https://* ]]; then
  fail "Cloud Run did not report a valid HTTPS URL for ${CANDIDATE_TAG}."
fi

if [[ "${CANDIDATE_TRAFFIC_PERCENT}" != "0" ]]; then
  fail "Candidate revision ${REVISION_NAME} already has ${CANDIDATE_TRAFFIC_PERCENT}% production traffic."
fi

REVISION_JSON="$("${GCLOUD}" run revisions describe "${REVISION_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
IFS=$'\t' read -r REPORTED_REVISION SPEC_IMAGE DIGEST_IMAGE REVISION_READY <<<"$(revision_record "${REVISION_JSON}")"

if [[ "${REPORTED_REVISION}" != "${REVISION_NAME}" ]]; then
  fail "Cloud Run returned revision ${REPORTED_REVISION}, not ${REVISION_NAME}."
fi

if [[ "${REVISION_READY}" != "true" ]]; then
  fail "Candidate revision ${REVISION_NAME} is not Ready."
fi

if [[ "${DIGEST_IMAGE}" != "${EXPECTED_IMAGE}" ]]; then
  fail "Candidate revision resolved image digest does not match approved image ${EXPECTED_IMAGE}."
fi
if [[ "${SPEC_IMAGE}" != "-" && "${SPEC_IMAGE}" != "${EXPECTED_IMAGE}" ]]; then
  fail "Candidate revision spec image contradicts approved image ${EXPECTED_IMAGE}."
fi

HEALTH_BODY_FILE="$(mktemp)"
trap 'rm -f "${HEALTH_BODY_FILE}"' EXIT
HEALTH_STATUS="$("${CURL}" \
  --fail \
  --silent \
  --show-error \
  --retry 3 \
  --retry-all-errors \
  --max-time 10 \
  --output "${HEALTH_BODY_FILE}" \
  --write-out '%{http_code}' \
  "${CANDIDATE_URL%/}/health")"

if [[ "${HEALTH_STATUS}" != "200" ]]; then
  fail "Candidate health check returned HTTP ${HEALTH_STATUS}; production traffic was not changed."
fi

# Close the validation-to-use gap by ensuring the tag still resolves to the
# approved zero-traffic revision immediately before changing traffic.
SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
if ! CANDIDATE_DETAILS="$(candidate_record "${SERVICE_JSON}" "${CANDIDATE_TAG}")"; then
  fail "Cloud Run no longer reports one unambiguous target for ${CANDIDATE_TAG}."
fi
IFS=$'\t' read -r VERIFIED_REVISION VERIFIED_URL VERIFIED_TRAFFIC_PERCENT VERIFIED_OTHER_PERCENT SERVICE_URL <<<"${CANDIDATE_DETAILS}"

if [[ "${VERIFIED_REVISION}" != "${REVISION_NAME}" || "${VERIFIED_URL}" != "${CANDIDATE_URL}" ]]; then
  fail "Candidate tag ${CANDIDATE_TAG} changed during pre-promotion verification."
fi

if [[ "${VERIFIED_TRAFFIC_PERCENT}" != "0" ]]; then
  fail "Candidate revision ${REVISION_NAME} received production traffic before promotion."
fi

"${GCLOUD}" run services update-traffic "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --to-revisions "${REVISION_NAME}=100" \
  --quiet \
  --format=json >/dev/null

SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
if ! CANDIDATE_DETAILS="$(candidate_record "${SERVICE_JSON}" "${CANDIDATE_TAG}")"; then
  fail "Cloud Run did not retain the candidate tag after promotion."
fi
IFS=$'\t' read -r PROMOTED_REVISION PROMOTED_URL PROMOTED_TRAFFIC_PERCENT REMAINING_TRAFFIC_PERCENT SERVICE_URL <<<"${CANDIDATE_DETAILS}"

if [[ "${PROMOTED_REVISION}" != "${REVISION_NAME}" || "${PROMOTED_TRAFFIC_PERCENT}" != "100" || "${REMAINING_TRAFFIC_PERCENT}" != "0" ]]; then
  fail "Cloud Run did not report 100% traffic on exact revision ${REVISION_NAME}."
fi

printf 'promoted_revision=%s\n' "${PROMOTED_REVISION}"
printf 'promoted_tag=%s\n' "${CANDIDATE_TAG}"
printf 'promoted_image=%s\n' "${EXPECTED_IMAGE}"
printf 'promotion_health_http_status=%s\n' "${HEALTH_STATUS}"
printf 'promoted_traffic_percent=%s\n' "${PROMOTED_TRAFFIC_PERCENT}"
printf 'remaining_traffic_percent=%s\n' "${REMAINING_TRAFFIC_PERCENT}"
printf 'service_url=%s\n' "${SERVICE_URL}"
