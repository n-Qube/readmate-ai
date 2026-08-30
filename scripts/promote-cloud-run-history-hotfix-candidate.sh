#!/usr/bin/env bash
set -euo pipefail

REVISION_NAME="${1:?exact history-hotfix candidate revision is required}"
CANDIDATE_TAG="${2:?exact history-hotfix candidate tag is required}"
EXPECTED_IMAGE="${3:?immutable history-hotfix candidate image is required}"
BASE_REVISION="${4:?exact pre-hotfix live revision is required}"
EXPECTED_BASE_CONFIG_DIGEST="${5:?baseline configuration sha256 is required}"

readonly PROJECT_ID="billbridge-c684f"
readonly REGION="us-central1"
readonly SERVICE_NAME="readmate-api"
readonly IMAGE_REPOSITORY="us-central1-docker.pkg.dev/billbridge-c684f/readmate/readmate-api"
readonly V2_SERVICE_NAME="projects/${PROJECT_ID}/locations/${REGION}/services/${SERVICE_NAME}"
readonly V2_SERVICE_URL="https://run.googleapis.com/v2/${V2_SERVICE_NAME}"

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
containers[0].pop("image", None)

annotations = copy.deepcopy(revision.get("metadata", {}).get("annotations", {}))
volatile_annotations = {
    "run.googleapis.com/operation-id",
    "serving.knative.dev/creator",
    "serving.knative.dev/lastModifier",
    "run.googleapis.com/client-name",
    "run.googleapis.com/client-version",
    "client.knative.dev/user-image",
}
for key in volatile_annotations:
    annotations.pop(key, None)

configuration = {"spec": spec, "annotations": annotations}
canonical = json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
print(hashlib.sha256(canonical).hexdigest())
' <<<"${revision_json}"
}

validate_candidate_state() {
  local service_json="$1"
  local expected_live_revision="$2"

  local latest_created live_revision details tagged_revision candidate_url candidate_percent
  latest_created="$(service_latest_created_revision "${service_json}")"
  if [[ "${latest_created}" != "${REVISION_NAME}" ]]; then
    fail "Latest created revision ${latest_created} is not approved candidate ${REVISION_NAME}."
  fi

  if ! live_revision="$(service_live_revision "${service_json}")"; then
    fail "Cloud Run must have exactly one revision receiving 100% traffic before promotion."
  fi
  if [[ "${live_revision}" != "${expected_live_revision}" ]]; then
    fail "The 100% live revision is ${live_revision}, not approved baseline ${expected_live_revision}."
  fi

  if ! details="$(candidate_record "${service_json}" "${CANDIDATE_TAG}")"; then
    fail "Cloud Run did not report one unambiguous target for ${CANDIDATE_TAG}."
  fi
  IFS=$'\t' read -r tagged_revision candidate_url candidate_percent <<<"${details}"
  if [[ "${tagged_revision}" != "${REVISION_NAME}" ]]; then
    fail "Candidate tag ${CANDIDATE_TAG} points to ${tagged_revision}, not ${REVISION_NAME}."
  fi
  if [[ "${candidate_url}" == "-" || "${candidate_url}" != https://* ]]; then
    fail "Cloud Run did not report a valid HTTPS URL for ${CANDIDATE_TAG}."
  fi
  if [[ "${candidate_percent}" != "0" ]]; then
    fail "Candidate ${REVISION_NAME} already has ${candidate_percent}% production traffic."
  fi

  printf '%s\n' "${candidate_url}"
}

validate_revision_pair() {
  local base_revision_json="$1"
  local candidate_revision_json="$2"
  local reported_base base_spec_image base_digest_image base_ready
  local reported_candidate candidate_spec_image candidate_digest_image candidate_ready
  local actual_base_config candidate_config

  IFS=$'\t' read -r reported_base base_spec_image base_digest_image base_ready <<<"$(revision_record "${base_revision_json}")"
  if [[ "${reported_base}" != "${BASE_REVISION}" || "${base_ready}" != "true" ]]; then
    fail "Baseline revision ${BASE_REVISION} is missing or not Ready."
  fi

  actual_base_config="$(revision_config_digest "${base_revision_json}")"
  if [[ "${actual_base_config}" != "${EXPECTED_BASE_CONFIG_DIGEST}" ]]; then
    fail "Baseline revision configuration no longer matches approved digest ${EXPECTED_BASE_CONFIG_DIGEST}."
  fi

  IFS=$'\t' read -r reported_candidate candidate_spec_image candidate_digest_image candidate_ready <<<"$(revision_record "${candidate_revision_json}")"
  if [[ "${reported_candidate}" != "${REVISION_NAME}" || "${candidate_ready}" != "true" ]]; then
    fail "Candidate revision ${REVISION_NAME} is missing or not Ready."
  fi
  if [[ "${candidate_digest_image}" != "${EXPECTED_IMAGE}" ]]; then
    fail "Candidate revision resolved image digest does not match approved image ${EXPECTED_IMAGE}."
  fi
  if [[ "${candidate_spec_image}" != "-" && "${candidate_spec_image}" != "${EXPECTED_IMAGE}" ]]; then
    fail "Candidate revision spec image contradicts approved image ${EXPECTED_IMAGE}."
  fi

  candidate_config="$(revision_config_digest "${candidate_revision_json}")"
  if [[ "${candidate_config}" != "${EXPECTED_BASE_CONFIG_DIGEST}" ]]; then
    fail "Candidate revision configuration differs from approved baseline configuration."
  fi
}

prepare_v2_promotion_body() {
  local service_json="$1"
  local output_path="$2"

  "${PYTHON}" -c '
import json
import sys

expected_name, base_revision, candidate_revision, candidate_tag, output_path = sys.argv[1:]
service = json.load(sys.stdin)

def revision_name(value):
    return str(value or "").rsplit("/", 1)[-1]

if service.get("name") != expected_name:
    raise SystemExit("Cloud Run v2 service name does not match the pinned destination")
etag = service.get("etag")
if not isinstance(etag, str) or not etag:
    raise SystemExit("Cloud Run v2 service did not provide a usable etag")
generation = str(service.get("generation") or "")
observed_generation = str(service.get("observedGeneration") or "")
if not generation.isdigit() or generation != observed_generation:
    raise SystemExit("Cloud Run v2 service generation is not fully reconciled")
if service.get("reconciling", False):
    raise SystemExit("Cloud Run v2 service is still reconciling")
terminal = service.get("terminalCondition") or {}
if terminal.get("state") != "CONDITION_SUCCEEDED":
    raise SystemExit("Cloud Run v2 service is not Ready")
if revision_name(service.get("latestCreatedRevision")) != candidate_revision:
    raise SystemExit("Cloud Run v2 latest-created revision changed before promotion")
if revision_name(service.get("latestReadyRevision")) != candidate_revision:
    raise SystemExit("Cloud Run v2 latest-ready revision changed before promotion")

traffic = service.get("traffic")
if not isinstance(traffic, list) or not traffic:
    raise SystemExit("Cloud Run v2 service has no traffic configuration")
allocations = {}
tagged = []
candidate_tag_matches = 0
for item in traffic:
    if not isinstance(item, dict):
        raise SystemExit("Cloud Run v2 traffic entry is invalid")
    if item.get("type") != "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION":
        raise SystemExit("Cloud Run v2 traffic must target exact revisions only")
    revision = revision_name(item.get("revision"))
    if not revision:
        raise SystemExit("Cloud Run v2 traffic entry has no exact revision")
    percent = int(item.get("percent") or 0)
    if percent < 0 or percent > 100:
        raise SystemExit("Cloud Run v2 traffic percentage is invalid")
    if percent:
        allocations[revision] = allocations.get(revision, 0) + percent
    tag = item.get("tag")
    if tag:
        if percent:
            raise SystemExit("Tagged Cloud Run traffic unexpectedly carries production traffic")
        tagged.append({
            "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
            "revision": revision,
            "tag": tag,
        })
        if tag == candidate_tag:
            candidate_tag_matches += 1
            if revision != candidate_revision:
                raise SystemExit("Cloud Run v2 candidate tag points to another revision")

if allocations != {base_revision: 100}:
    raise SystemExit(f"Cloud Run v2 production traffic changed before promotion: {allocations!r}")
if candidate_tag_matches != 1:
    raise SystemExit("Cloud Run v2 candidate tag is missing or ambiguous")

body = {
    "name": expected_name,
    "etag": etag,
    "traffic": [
        {
            "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
            "revision": candidate_revision,
            "percent": 100,
        },
        *tagged,
    ],
}
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(body, handle, sort_keys=True, separators=(",", ":"))
    handle.write("\n")
print(generation)
' "${V2_SERVICE_NAME}" "${BASE_REVISION}" "${REVISION_NAME}" "${CANDIDATE_TAG}" "${output_path}" <<<"${service_json}"
}

operation_state() {
  local operation_json="$1"

  "${PYTHON}" -c '
import json
import sys

operation = json.load(sys.stdin)
name = operation.get("name")
if not isinstance(name, str) or not name:
    raise SystemExit("Cloud Run v2 promotion did not return an operation name")
error = operation.get("error")
if error:
    raise SystemExit("Cloud Run v2 promotion operation failed: " + json.dumps(error, sort_keys=True))
print(name + "\t" + ("true" if operation.get("done") is True else "false"))
' <<<"${operation_json}"
}

if [[ "${CONFIRM_REVISION:-}" != "${REVISION_NAME}" ]]; then
  fail "Set CONFIRM_REVISION to exact revision ${REVISION_NAME} to authorize production traffic promotion."
fi

if [[ ! "${EXPECTED_BASE_CONFIG_DIGEST}" =~ ^[0-9a-f]{64}$ ]]; then
  fail "EXPECTED_BASE_CONFIG_DIGEST must be the candidate build's 64-character lowercase sha256."
fi

RELEASE_ID="${CANDIDATE_TAG#history-hotfix-}"
if [[ "${CANDIDATE_TAG}" != "history-hotfix-${RELEASE_ID}" || ! "${RELEASE_ID}" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
  fail "CANDIDATE_TAG must be the exact history-hotfix tag emitted by the candidate build."
fi
if [[ "${REVISION_NAME}" != "${SERVICE_NAME}-hist-${RELEASE_ID}" ]]; then
  fail "Revision ${REVISION_NAME} does not match candidate tag ${CANDIDATE_TAG}."
fi
if [[ "${BASE_REVISION}" != "${SERVICE_NAME}-"* || "${BASE_REVISION}" == "${REVISION_NAME}" ]]; then
  fail "BASE_REVISION must be the distinct pre-hotfix revision emitted by the candidate build."
fi

EXPECTED_DIGEST="${EXPECTED_IMAGE##*@}"
if [[ "${EXPECTED_IMAGE}" != "${IMAGE_REPOSITORY}@${EXPECTED_DIGEST}" || ! "${EXPECTED_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  fail "EXPECTED_IMAGE must be the pinned ReadMate API image@sha256 emitted by the candidate build."
fi

SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
CANDIDATE_URL="$(validate_candidate_state "${SERVICE_JSON}" "${BASE_REVISION}")"

BASE_REVISION_JSON="$("${GCLOUD}" run revisions describe "${BASE_REVISION}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
CANDIDATE_REVISION_JSON="$("${GCLOUD}" run revisions describe "${REVISION_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
validate_revision_pair "${BASE_REVISION_JSON}" "${CANDIDATE_REVISION_JSON}"

umask 077
PROMOTION_TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${PROMOTION_TEMP_DIR}"' EXIT
HEALTH_BODY_FILE="${PROMOTION_TEMP_DIR}/health.json"
V2_SERVICE_FILE="${PROMOTION_TEMP_DIR}/service.json"
V2_PROMOTION_BODY_FILE="${PROMOTION_TEMP_DIR}/promotion.json"
V2_OPERATION_FILE="${PROMOTION_TEMP_DIR}/operation.json"
AUTH_CONFIG_FILE="${PROMOTION_TEMP_DIR}/curl-auth.conf"
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
  fail "Candidate health check returned HTTP ${HEALTH_STATUS}; traffic was not changed."
fi

# Revalidate the immutable revisions and exact live/candidate allocation after
# the health probe, immediately before the one authorized traffic change.
SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
VERIFIED_URL="$(validate_candidate_state "${SERVICE_JSON}" "${BASE_REVISION}")"
if [[ "${VERIFIED_URL}" != "${CANDIDATE_URL}" ]]; then
  fail "Candidate URL changed during promotion verification."
fi
BASE_REVISION_JSON="$("${GCLOUD}" run revisions describe "${BASE_REVISION}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
CANDIDATE_REVISION_JSON="$("${GCLOUD}" run revisions describe "${REVISION_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
validate_revision_pair "${BASE_REVISION_JSON}" "${CANDIDATE_REVISION_JSON}"

ACCESS_TOKEN="$("${GCLOUD}" auth print-access-token --quiet)"
if [[ ! "${ACCESS_TOKEN}" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  fail "Cloud SDK did not return a usable access token for the etag-guarded promotion."
fi
printf 'header = "Authorization: Bearer %s"\n' "${ACCESS_TOKEN}" >"${AUTH_CONFIG_FILE}"
unset ACCESS_TOKEN

V2_STATUS="$("${CURL}" \
  --config "${AUTH_CONFIG_FILE}" \
  --fail \
  --silent \
  --show-error \
  --max-time 15 \
  --output "${V2_SERVICE_FILE}" \
  --write-out '%{http_code}' \
  "${V2_SERVICE_URL}")"
if [[ "${V2_STATUS}" != "200" ]]; then
  fail "Cloud Run v2 precondition read returned HTTP ${V2_STATUS}; traffic was not changed."
fi
V2_SERVICE_JSON="$(<"${V2_SERVICE_FILE}")"
V2_GENERATION="$(prepare_v2_promotion_body "${V2_SERVICE_JSON}" "${V2_PROMOTION_BODY_FILE}")"

if ! V2_PATCH_STATUS="$("${CURL}" \
  --config "${AUTH_CONFIG_FILE}" \
  --fail \
  --silent \
  --show-error \
  --max-time 30 \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --data-binary "@${V2_PROMOTION_BODY_FILE}" \
  --output "${V2_OPERATION_FILE}" \
  --write-out '%{http_code}' \
  "${V2_SERVICE_URL}?updateMask=traffic")"; then
  fail "Cloud Run rejected the etag-guarded traffic promotion; do not retry without a full preflight."
fi
if [[ "${V2_PATCH_STATUS}" != "200" ]]; then
  fail "Cloud Run v2 traffic promotion returned HTTP ${V2_PATCH_STATUS}; do not retry without a full preflight."
fi

V2_OPERATION_JSON="$(<"${V2_OPERATION_FILE}")"
IFS=$'\t' read -r V2_OPERATION_NAME V2_OPERATION_DONE <<<"$(operation_state "${V2_OPERATION_JSON}")"
for _ in {1..30}; do
  [[ "${V2_OPERATION_DONE}" == "true" ]] && break
  sleep 2
  V2_OPERATION_STATUS="$("${CURL}" \
    --config "${AUTH_CONFIG_FILE}" \
    --fail \
    --silent \
    --show-error \
    --max-time 15 \
    --output "${V2_OPERATION_FILE}" \
    --write-out '%{http_code}' \
    "https://run.googleapis.com/v2/${V2_OPERATION_NAME}")"
  if [[ "${V2_OPERATION_STATUS}" != "200" ]]; then
    fail "Cloud Run v2 promotion operation lookup returned HTTP ${V2_OPERATION_STATUS}."
  fi
  V2_OPERATION_JSON="$(<"${V2_OPERATION_FILE}")"
  IFS=$'\t' read -r REPORTED_OPERATION_NAME V2_OPERATION_DONE <<<"$(operation_state "${V2_OPERATION_JSON}")"
  [[ "${REPORTED_OPERATION_NAME}" == "${V2_OPERATION_NAME}" ]] || fail "Cloud Run v2 promotion operation identity changed."
done
[[ "${V2_OPERATION_DONE}" == "true" ]] || fail "Cloud Run v2 promotion operation did not complete in time."

SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
LATEST_CREATED_REVISION="$(service_latest_created_revision "${SERVICE_JSON}")"
if ! LIVE_REVISION="$(service_live_revision "${SERVICE_JSON}")"; then
  fail "Cloud Run did not settle on one 100% live revision after promotion."
fi
if [[ "${LATEST_CREATED_REVISION}" != "${REVISION_NAME}" || "${LIVE_REVISION}" != "${REVISION_NAME}" ]]; then
  fail "Cloud Run did not report exact revision ${REVISION_NAME} at 100% after promotion."
fi
if ! PROMOTED_DETAILS="$(candidate_record "${SERVICE_JSON}" "${CANDIDATE_TAG}")"; then
  fail "Cloud Run did not retain exact candidate tag ${CANDIDATE_TAG} after promotion."
fi
IFS=$'\t' read -r PROMOTED_REVISION PROMOTED_URL PROMOTED_PERCENT <<<"${PROMOTED_DETAILS}"
if [[ "${PROMOTED_REVISION}" != "${REVISION_NAME}" || "${PROMOTED_URL}" != "${CANDIDATE_URL}" || "${PROMOTED_PERCENT}" != "100" ]]; then
  fail "Post-promotion tag evidence does not match exact revision ${REVISION_NAME}."
fi

printf 'promoted_revision=%s\n' "${PROMOTED_REVISION}"
printf 'promoted_tag=%s\n' "${CANDIDATE_TAG}"
printf 'promoted_image=%s\n' "${EXPECTED_IMAGE}"
printf 'promoted_from_revision=%s\n' "${BASE_REVISION}"
printf 'approved_base_config_sha256=%s\n' "${EXPECTED_BASE_CONFIG_DIGEST}"
printf 'promotion_precondition=cloud-run-v2-etag\n'
printf 'promotion_service_generation=%s\n' "${V2_GENERATION}"
printf 'promotion_health_http_status=%s\n' "${HEALTH_STATUS}"
printf 'promoted_traffic_percent=%s\n' "${PROMOTED_PERCENT}"
printf 'project=%s\n' "${PROJECT_ID}"
printf 'region=%s\n' "${REGION}"
printf 'service=%s\n' "${SERVICE_NAME}"
