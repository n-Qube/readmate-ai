#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:?container image tag is required}"
REGION="${2:?region is required}"
SERVICE_NAME="${3:?service name is required}"
EXTENSION_ORIGIN="${4:?exact extension origin is required}"
WEB_APP_ORIGIN="${5:?exact HTTPS web app origin is required}"
PROJECT_ID="${6:?project id is required}"
RELEASE_ID="${7:?Cloud Build release id is required}"
ENABLE_REVENUECAT="${8:-false}"

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

# Cloud Run treats literal environment variables and Secret Manager-backed
# variables as different update types. Remove any legacy literal credentials
# in the same no-traffic deployment that adds their existing secret references.
SECRET_ENV_KEYS="CLERK_SECRET_KEY,CLERK_PUBLISHABLE_KEY,DATABASE_URL,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,GEMINI_API_KEY,KHAYA_API_KEY,REVENUECAT_SECRET_API_KEY,WEBMCP_AUDIT_DIGEST_KEY,CRON_SECRET"

if [[ ! "${SERVICE_NAME}" =~ ^[a-z]([-a-z0-9]*[a-z0-9])?$ ]]; then
  fail "SERVICE_NAME must be a lowercase Cloud Run service name."
fi

if [[ ! "${RELEASE_ID}" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then
  fail "RELEASE_ID must contain only lowercase letters, numbers, and internal hyphens."
fi

if [[ "${ENABLE_REVENUECAT}" != "true" && "${ENABLE_REVENUECAT}" != "false" ]]; then
  fail "ENABLE_REVENUECAT must be exactly true or false."
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
# a stable 64-bit fingerprint for the revision and traffic tag.
CANDIDATE_TAG="candidate-${SHORT_RELEASE_ID}"
REVISION_SUFFIX="build-${SHORT_RELEASE_ID}"
EXPECTED_REVISION="${SERVICE_NAME}-${REVISION_SUFFIX}"

if (( ${#SERVICE_NAME} + ${#CANDIDATE_TAG} > 46 )); then
  fail "The derived candidate tag and service name exceed Cloud Run's 46-character combined limit."
fi

if (( ${#EXPECTED_REVISION} > 63 )); then
  fail "The derived revision name exceeds Cloud Run's 63-character limit."
fi

if [[ ! "${EXTENSION_ORIGIN}" =~ ^chrome-extension://[a-p]{32}$ ]]; then
  fail "EXTENSION_ORIGIN must be the exact production chrome-extension:// origin."
fi

if ! "${PYTHON}" -c 'import sys; from urllib.parse import urlsplit; u=urlsplit(sys.argv[1]); assert u.scheme == "https" and u.hostname and not u.username and not u.password and not u.query and not u.fragment and u.path in ("", "/")' "${WEB_APP_ORIGIN}"; then
  fail "WEB_APP_ORIGIN must be one exact HTTPS origin without credentials, a path, query, or fragment."
fi

RUNTIME_SECRET_MAPPINGS="CLERK_SECRET_KEY=readmate-clerk-secret-key:latest,CLERK_PUBLISHABLE_KEY=readmate-clerk-publishable-key:latest,DATABASE_URL=readmate-database-app-url:latest,SUPABASE_URL=readmate-supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=readmate-supabase-service-role-key:latest,GEMINI_API_KEY=readmate-gemini-api-key:latest,KHAYA_API_KEY=readmate-khaya-api-key:latest,WEBMCP_AUDIT_DIGEST_KEY=readmate-webmcp-audit-digest-key:latest,CRON_SECRET=readmate-cron-secret:latest"
RUNTIME_ENV_VARS="NODE_ENV=production,DATABASE_APP_ROLE=readmate_api,DATABASE_CONNECTION_LIMIT=2,DATABASE_POOL_TIMEOUT_SECONDS=30,ALLOW_ANONYMOUS_TTS=false,EXTENSION_ORIGIN=${EXTENSION_ORIGIN},WEB_APP_ORIGIN=${WEB_APP_ORIGIN},SUPABASE_STORAGE_BUCKET=readmate-uploads,SUPABASE_MEDIA_BUCKET=readmate-media,OUTBOUND_REQUEST_TIMEOUT_MS=15000,DOCUMENT_PROCESSING_CONCURRENCY=2,TTS_DAILY_CHAR_LIMIT=500000,AI_DAILY_INPUT_CHAR_LIMIT=250000,UPLOAD_DAILY_BYTE_LIMIT=209715200,UPLOAD_TOTAL_BYTE_LIMIT=1073741824,UPLOAD_TOTAL_OBJECT_LIMIT=1000,UPLOAD_PENDING_OBJECT_LIMIT=20,KHAYA_SUBSCRIPTION_HEADER=Ocp-Apim-Subscription-Key,KHAYA_TTS_SPEAKER_ID=male_low,TWI_TTS_PROVIDER=nano-twi,NANO_TWI_NUM_THREADS=1,GEMINI_TTS_MODEL=gemini-3.8-flash-tts,GEMINI_TTS_LITE_MODEL=gemini-3.8-flash-lite-tts,GEMINI_TTS_TIMEOUT_MS=45000,GEMINI_LEARNING_TIMEOUT_MS=45000,ENABLE_RSS_REFRESH_WORKER=true,RSS_REFRESH_INTERVAL_MINUTES=30,FREE_MAX_UPLOAD_BYTES=10485760,FREE_MAX_DOCUMENT_CHARACTERS=100000,FREE_MAX_PDF_PAGES=50,FREE_TTS_DAILY_CHAR_LIMIT=25000,PREMIUM_MAX_UPLOAD_BYTES=52428800,PREMIUM_MAX_DOCUMENT_CHARACTERS=10000000,PREMIUM_MAX_PDF_PAGES=2000,PREMIUM_TTS_DAILY_CHAR_LIMIT=500000"
ENV_VARS_TO_REMOVE="${SECRET_ENV_KEYS}"
OPTIONAL_SECRET_ARG=""

if [[ "${ENABLE_REVENUECAT}" == "true" ]]; then
  RUNTIME_SECRET_MAPPINGS+=",REVENUECAT_SECRET_API_KEY=readmate-revenuecat-secret-api-key:latest"
  RUNTIME_ENV_VARS+=",REVENUECAT_ENTITLEMENT_ID=premium"
else
  # Omission alone would preserve an older Cloud Run binding. Remove both the
  # secret reference and entitlement id so billing-disabled releases stay Free.
  OPTIONAL_SECRET_ARG="--remove-secrets=REVENUECAT_SECRET_API_KEY"
  ENV_VARS_TO_REMOVE+=",REVENUECAT_ENTITLEMENT_ID"
fi

ARTIFACT_JSON="$("${GCLOUD}" artifacts docker images describe "${IMAGE_TAG}" \
  --project="${PROJECT_ID}" \
  --format=json)"
IMAGE_DIGEST="$("${PYTHON}" -c 'import json, sys; print(json.load(sys.stdin).get("image_summary", {}).get("digest", ""))' <<<"${ARTIFACT_JSON}")"

if [[ ! "${IMAGE_DIGEST}" =~ ^sha256:[0-9a-f]+$ ]] || [[ ${#IMAGE_DIGEST} -ne 71 ]]; then
  fail "Artifact Registry did not return a valid sha256 digest for ${IMAGE_TAG}."
fi

if [[ "${IMAGE_TAG}" == *@* ]]; then
  IMAGE_REPOSITORY="${IMAGE_TAG%@*}"
elif [[ "${IMAGE_TAG}" == *:* ]]; then
  IMAGE_REPOSITORY="${IMAGE_TAG%:*}"
else
  fail "The container image must include a tag or digest."
fi
IMMUTABLE_IMAGE="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"

"${GCLOUD}" run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --image "${IMMUTABLE_IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 10 \
  --timeout 60 \
  --min-instances 0 \
  --max-instances 3 \
  --service-account "readmate-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --no-traffic \
  --revision-suffix "${REVISION_SUFFIX}" \
  --tag "${CANDIDATE_TAG}" \
  --remove-env-vars "${ENV_VARS_TO_REMOVE}" \
  ${OPTIONAL_SECRET_ARG:+"${OPTIONAL_SECRET_ARG}"} \
  --update-secrets "${RUNTIME_SECRET_MAPPINGS}" \
  --update-env-vars "${RUNTIME_ENV_VARS}" \
  --quiet \
  --format=json >/dev/null

SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"

if ! CANDIDATE_DETAILS="$(candidate_record "${SERVICE_JSON}" "${CANDIDATE_TAG}")"; then
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

REVISION_JSON="$("${GCLOUD}" run revisions describe "${CANDIDATE_REVISION}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
IFS=$'\t' read -r REPORTED_REVISION SPEC_IMAGE DIGEST_IMAGE REVISION_READY <<<"$(revision_record "${REVISION_JSON}")"

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

# Re-read the tag after the probe so the evidence cannot silently refer to a
# tag that was moved while the request was in flight.
SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format=json)"
if ! CANDIDATE_DETAILS="$(candidate_record "${SERVICE_JSON}" "${CANDIDATE_TAG}")"; then
  fail "Cloud Run no longer reports one unambiguous target for ${CANDIDATE_TAG}."
fi
IFS=$'\t' read -r VERIFIED_REVISION VERIFIED_URL VERIFIED_TRAFFIC_PERCENT <<<"${CANDIDATE_DETAILS}"

if [[ "${VERIFIED_REVISION}" != "${CANDIDATE_REVISION}" || "${VERIFIED_URL}" != "${CANDIDATE_URL}" ]]; then
  fail "Candidate tag ${CANDIDATE_TAG} changed during verification."
fi

if [[ "${VERIFIED_TRAFFIC_PERCENT}" != "0" ]]; then
  fail "Candidate revision ${CANDIDATE_REVISION} received production traffic during verification."
fi

printf 'candidate_release_id=%s\n' "${RELEASE_ID}"
printf 'candidate_revision=%s\n' "${CANDIDATE_REVISION}"
printf 'candidate_tag=%s\n' "${CANDIDATE_TAG}"
printf 'candidate_image=%s\n' "${IMMUTABLE_IMAGE}"
printf 'candidate_url=%s\n' "${CANDIDATE_URL}"
printf 'candidate_health_http_status=%s\n' "${HEALTH_STATUS}"
printf 'candidate_traffic_percent=%s\n' "${VERIFIED_TRAFFIC_PERCENT}"
printf 'release_gate=manual_exact_revision_promotion_required\n'
