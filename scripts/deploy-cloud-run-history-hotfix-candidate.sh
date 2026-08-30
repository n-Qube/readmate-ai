#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:?container image tag is required}"
RELEASE_ID="${2:?Cloud Build release id is required}"

readonly PROJECT_ID="billbridge-c684f"
readonly REGION="us-central1"
readonly SERVICE_NAME="readmate-api"
readonly IMAGE_REPOSITORY="us-central1-docker.pkg.dev/billbridge-c684f/readmate/readmate-api"

GCLOUD="${GCLOUD:-gcloud}"
CURL="${CURL:-curl}"
PYTHON="${PYTHON:-python3}"

fail() {
  echo "$*" >&2
  exit 1
}

service_latest_created_revision() {
  local service_json="$1"

  "${PYTHON}" -c '
import json
import sys

service = json.load(sys.stdin)
print(service.get("status", {}).get("latestCreatedRevisionName") or "-")
' <<<"${service_json}"
}

service_live_revision() {
  local service_json="$1"

  "${PYTHON}" -c '
import json
import sys

service = json.load(sys.stdin)
allocations = {}
for item in service.get("status", {}).get("traffic", []):
    percent = int(item.get("percent") or 0)
    if percent == 0:
        continue
    revision = item.get("revisionName")
    if not revision:
        raise SystemExit("nonzero traffic target does not resolve to an exact revision")
    allocations[revision] = allocations.get(revision, 0) + percent

if len(allocations) != 1 or sum(allocations.values()) != 100:
    raise SystemExit(
        f"expected exactly one live revision with 100% traffic, found {allocations!r}"
    )
print(next(iter(allocations)))
' <<<"${service_json}"
}

assert_tag_absent() {
  local service_json="$1"
  local candidate_tag="$2"

  "${PYTHON}" -c '
import json
import sys

service = json.load(sys.stdin)
tag = sys.argv[1]
matches = [item for item in service.get("status", {}).get("traffic", []) if item.get("tag") == tag]
if matches:
    raise SystemExit(f"candidate tag {tag!r} already exists")
' "${candidate_tag}" <<<"${service_json}"
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
percent = sum(int(item.get("percent") or 0) for item in traffic if item.get("revisionName") == revision)
print(f"{revision}\t{url}\t{percent}")
' "${candidate_tag}" <<<"${service_json}"
}

production_traffic_digest() {
  local service_json="$1"
  local excluded_revision="${2:-}"

  "${PYTHON}" -c '
import hashlib
import json
import sys

service = json.load(sys.stdin)
excluded_revision = sys.argv[1]
allocations = {}
for item in service.get("status", {}).get("traffic", []):
    percent = int(item.get("percent") or 0)
    if percent == 0:
        continue
    revision = item.get("revisionName") or ("LATEST" if item.get("latestRevision") else "-")
    if revision == excluded_revision:
        continue
    allocations[revision] = allocations.get(revision, 0) + percent
canonical = json.dumps(allocations, sort_keys=True, separators=(",", ":")).encode()
print(hashlib.sha256(canonical).hexdigest())
' "${excluded_revision}" <<<"${service_json}"
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

revision_config_digest() {
  local revision_json="$1"

  "${PYTHON}" -c '
import copy
import hashlib
import json
import sys

revision = json.load(sys.stdin)
spec = copy.deepcopy(revision.get("spec", {}))
containers = spec.get("containers", [])
if not containers:
    raise SystemExit("revision has no containers")

# The history hotfix may replace only the primary application image. Every
# other revision setting remains part of the signed comparison, including
# commands, arguments, ports, probes, resources, environment variables,
# Secret Manager references, service identity, scaling, and timeouts.
containers[0].pop("image", None)
annotations = copy.deepcopy(revision.get("metadata", {}).get("annotations", {}))
volatile_annotations = {
    # Operation and actor identity are regenerated for each immutable revision.
    "run.googleapis.com/operation-id",
    "serving.knative.dev/creator",
    "serving.knative.dev/lastModifier",
    "run.googleapis.com/client-name",
    "run.googleapis.com/client-version",
    # The user-image annotation is another representation of the one allowed
    # application image change already removed from the primary container.
    "client.knative.dev/user-image",
}
for key in volatile_annotations:
    annotations.pop(key, None)

configuration = {"spec": spec, "annotations": annotations}
canonical = json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
print(hashlib.sha256(canonical).hexdigest())
' <<<"${revision_json}"
}

if [[ ! "${RELEASE_ID}" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
  fail "RELEASE_ID must contain only lowercase letters, numbers, and internal hyphens."
fi

SHORT_RELEASE_ID="$("${PYTHON}" -c '
import hashlib
import sys

print(hashlib.sha256(sys.argv[1].encode("ascii")).hexdigest()[:16])
' "${RELEASE_ID}")"
if [[ ! "${SHORT_RELEASE_ID}" =~ ^[0-9a-f]{16}$ ]]; then
  fail "Could not derive a stable short release id for the Cloud Run tag."
fi

# Cloud Run limits the combined service-name and traffic-tag length to 46
# characters. Keep the full release id on the immutable image tag, while using
# a collision-checked 64-bit fingerprint for the revision and traffic tag.
CANDIDATE_TAG="history-hotfix-${SHORT_RELEASE_ID}"
REVISION_SUFFIX="hist-${SHORT_RELEASE_ID}"
EXPECTED_REVISION="${SERVICE_NAME}-${REVISION_SUFFIX}"

if (( ${#SERVICE_NAME} + ${#CANDIDATE_TAG} > 46 )); then
  fail "The derived candidate tag and service name exceed Cloud Run's 46-character combined limit."
fi

if (( ${#EXPECTED_REVISION} > 63 )); then
  fail "The derived revision name exceeds Cloud Run's 63-character limit."
fi

SERVICE_JSON_BEFORE="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"

LATEST_CREATED_REVISION="$(service_latest_created_revision "${SERVICE_JSON_BEFORE}")"
if [[ "${LATEST_CREATED_REVISION}" == "-" ]]; then
  fail "Cloud Run did not report a latest created revision to use as the configuration baseline."
fi

if ! LIVE_REVISION="$(service_live_revision "${SERVICE_JSON_BEFORE}")"; then
  fail "Cloud Run must have exactly one revision receiving 100% traffic before this hotfix can proceed."
fi

if [[ "${LATEST_CREATED_REVISION}" != "${LIVE_REVISION}" ]]; then
  fail "Latest created revision ${LATEST_CREATED_REVISION} is not the 100% live revision ${LIVE_REVISION}; refusing to inherit an unpromoted candidate configuration."
fi

BASE_REVISION="${LIVE_REVISION}"

if ! assert_tag_absent "${SERVICE_JSON_BEFORE}" "${CANDIDATE_TAG}"; then
  fail "Refusing to reuse existing candidate tag ${CANDIDATE_TAG}."
fi

BASE_REVISION_JSON="$("${GCLOUD}" run revisions describe "${BASE_REVISION}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
BASE_CONFIG_DIGEST="$(revision_config_digest "${BASE_REVISION_JSON}")"
TRAFFIC_DIGEST_BEFORE="$(production_traffic_digest "${SERVICE_JSON_BEFORE}")"

ARTIFACT_JSON="$("${GCLOUD}" artifacts docker images describe "${IMAGE_TAG}" \
  --project="${PROJECT_ID}" \
  --format=json)"
IMAGE_DIGEST="$("${PYTHON}" -c 'import json, sys; print(json.load(sys.stdin).get("image_summary", {}).get("digest", ""))' <<<"${ARTIFACT_JSON}")"

if [[ ! "${IMAGE_DIGEST}" =~ ^sha256:[0-9a-f]+$ ]] || [[ ${#IMAGE_DIGEST} -ne 71 ]]; then
  fail "Artifact Registry did not return a valid sha256 digest for ${IMAGE_TAG}."
fi

if [[ "${IMAGE_TAG}" != "${IMAGE_REPOSITORY}:history-hotfix-${RELEASE_ID}" ]]; then
  fail "The image tag must be the pinned history-hotfix image for release ${RELEASE_ID}."
fi
IMMUTABLE_IMAGE="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"

# Deliberately pass no configuration flags here. Cloud Run creates the new
# revision from the service's existing template, replacing only the image and
# adding the unique revision suffix and zero-traffic tag.
"${GCLOUD}" run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --platform=managed \
  --image="${IMMUTABLE_IMAGE}" \
  --no-traffic \
  --revision-suffix="${REVISION_SUFFIX}" \
  --tag="${CANDIDATE_TAG}" \
  --quiet \
  --format=json >/dev/null

SERVICE_JSON_AFTER="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"

if ! CANDIDATE_DETAILS="$(candidate_record "${SERVICE_JSON_AFTER}" "${CANDIDATE_TAG}")"; then
  fail "Cloud Run did not report one unambiguous target for ${CANDIDATE_TAG}."
fi
IFS=$'\t' read -r CANDIDATE_REVISION CANDIDATE_URL CANDIDATE_TRAFFIC_PERCENT <<<"${CANDIDATE_DETAILS}"

if [[ "${CANDIDATE_REVISION}" != "${EXPECTED_REVISION}" ]]; then
  fail "Candidate tag ${CANDIDATE_TAG} points to ${CANDIDATE_REVISION}, not expected revision ${EXPECTED_REVISION}."
fi

if [[ "${CANDIDATE_URL}" == "-" || "${CANDIDATE_URL}" != https://* ]]; then
  fail "Cloud Run did not report a valid HTTPS URL for ${CANDIDATE_TAG}."
fi

if [[ "${CANDIDATE_TRAFFIC_PERCENT}" != "0" ]]; then
  fail "Candidate revision ${CANDIDATE_REVISION} unexpectedly has ${CANDIDATE_TRAFFIC_PERCENT}% production traffic."
fi

TRAFFIC_DIGEST_AFTER="$(production_traffic_digest "${SERVICE_JSON_AFTER}" "${CANDIDATE_REVISION}")"
if [[ "${TRAFFIC_DIGEST_AFTER}" != "${TRAFFIC_DIGEST_BEFORE}" ]]; then
  fail "Existing production traffic allocations changed while creating the no-traffic candidate."
fi

CANDIDATE_REVISION_JSON="$("${GCLOUD}" run revisions describe "${CANDIDATE_REVISION}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
IFS=$'\t' read -r REPORTED_REVISION SPEC_IMAGE DIGEST_IMAGE REVISION_READY <<<"$(revision_record "${CANDIDATE_REVISION_JSON}")"

if [[ "${REPORTED_REVISION}" != "${CANDIDATE_REVISION}" ]]; then
  fail "Cloud Run returned revision ${REPORTED_REVISION}, not ${CANDIDATE_REVISION}."
fi

if [[ "${REVISION_READY}" != "true" ]]; then
  fail "Candidate revision ${CANDIDATE_REVISION} is not Ready."
fi

if [[ "${DIGEST_IMAGE}" != "${IMMUTABLE_IMAGE}" ]]; then
  fail "Candidate revision resolved image digest does not match ${IMMUTABLE_IMAGE}."
fi
if [[ "${SPEC_IMAGE}" != "-" && "${SPEC_IMAGE}" != "${IMMUTABLE_IMAGE}" ]]; then
  fail "Candidate revision spec image contradicts ${IMMUTABLE_IMAGE}."
fi

CANDIDATE_CONFIG_DIGEST="$(revision_config_digest "${CANDIDATE_REVISION_JSON}")"
if [[ "${CANDIDATE_CONFIG_DIGEST}" != "${BASE_CONFIG_DIGEST}" ]]; then
  fail "Candidate revision configuration differs from baseline ${BASE_REVISION}; production traffic remains unchanged."
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
  fail "Candidate health check returned HTTP ${HEALTH_STATUS}."
fi

# Re-read both tag and traffic after the probe to produce stable evidence and
# to ensure this build never routed production traffic to the candidate.
SERVICE_JSON_VERIFIED="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
if ! VERIFIED_DETAILS="$(candidate_record "${SERVICE_JSON_VERIFIED}" "${CANDIDATE_TAG}")"; then
  fail "Cloud Run no longer reports one unambiguous target for ${CANDIDATE_TAG}."
fi
IFS=$'\t' read -r VERIFIED_REVISION VERIFIED_URL VERIFIED_TRAFFIC_PERCENT <<<"${VERIFIED_DETAILS}"
VERIFIED_TRAFFIC_DIGEST="$(production_traffic_digest "${SERVICE_JSON_VERIFIED}" "${CANDIDATE_REVISION}")"

if [[ "${VERIFIED_REVISION}" != "${CANDIDATE_REVISION}" || "${VERIFIED_URL}" != "${CANDIDATE_URL}" ]]; then
  fail "Candidate tag ${CANDIDATE_TAG} changed during verification."
fi

if [[ "${VERIFIED_TRAFFIC_PERCENT}" != "0" || "${VERIFIED_TRAFFIC_DIGEST}" != "${TRAFFIC_DIGEST_BEFORE}" ]]; then
  fail "Production traffic changed during candidate verification."
fi

printf 'history_hotfix_release_id=%s\n' "${RELEASE_ID}"
printf 'history_hotfix_base_revision=%s\n' "${BASE_REVISION}"
printf 'history_hotfix_base_config_sha256=%s\n' "${BASE_CONFIG_DIGEST}"
printf 'candidate_revision=%s\n' "${CANDIDATE_REVISION}"
printf 'candidate_tag=%s\n' "${CANDIDATE_TAG}"
printf 'candidate_image=%s\n' "${IMMUTABLE_IMAGE}"
printf 'candidate_url=%s\n' "${CANDIDATE_URL}"
printf 'candidate_health_http_status=%s\n' "${HEALTH_STATUS}"
printf 'candidate_traffic_percent=%s\n' "${VERIFIED_TRAFFIC_PERCENT}"
printf 'production_traffic_sha256_before=%s\n' "${TRAFFIC_DIGEST_BEFORE}"
printf 'production_traffic_sha256_after=%s\n' "${VERIFIED_TRAFFIC_DIGEST}"
printf 'database_schema_changes=skipped\n'
printf 'configuration_change_scope=image_revision_and_tag_only\n'
printf 'release_gate=no_traffic_no_promotion\n'
