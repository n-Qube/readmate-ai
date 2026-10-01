#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:?project id is required}"
EXTENSION_ORIGIN="${2:?exact extension origin is required}"
WEB_APP_ORIGIN="${3:?exact HTTPS web app origin is required}"
ENABLE_REVENUECAT="${4:-false}"

GCLOUD="${GCLOUD:-gcloud}"
PYTHON="${PYTHON:-python3}"

fail() {
  echo "$*" >&2
  exit 1
}

if [[ ! "${PROJECT_ID}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  fail "PROJECT_ID must be a valid Google Cloud project id."
fi

if [[ "${ENABLE_REVENUECAT}" != "true" && "${ENABLE_REVENUECAT}" != "false" ]]; then
  fail "ENABLE_REVENUECAT must be exactly true or false."
fi

if [[ ! "${EXTENSION_ORIGIN}" =~ ^chrome-extension://[a-p]{32}$ ]]; then
  fail "EXTENSION_ORIGIN must be the exact production chrome-extension:// origin."
fi

if ! "${PYTHON}" -c 'import sys; from urllib.parse import urlsplit; u=urlsplit(sys.argv[1]); assert u.scheme == "https" and u.hostname and not u.username and not u.password and not u.query and not u.fragment and u.path in ("", "/")' "${WEB_APP_ORIGIN}" 2>/dev/null; then
  fail "WEB_APP_ORIGIN must be one exact HTTPS origin without credentials, a path, query, or fragment."
fi

REQUIRED_SECRETS=(
  readmate-clerk-secret-key
  readmate-clerk-publishable-key
  readmate-database-app-url
  readmate-database-migration-url
  readmate-supabase-url
  readmate-supabase-service-role-key
  readmate-gemini-api-key
  readmate-khaya-api-key
  readmate-cron-secret
  readmate-webmcp-audit-digest-key
)

if [[ "${ENABLE_REVENUECAT}" == "true" ]]; then
  REQUIRED_SECRETS+=(readmate-revenuecat-secret-api-key)
fi

for secret_name in "${REQUIRED_SECRETS[@]}"; do
  if ! secret_state="$("${GCLOUD}" secrets versions describe latest \
    --secret="${secret_name}" \
    --project="${PROJECT_ID}" \
    --format='value(state)' 2>/dev/null)"; then
    fail "Required secret version is unavailable: ${secret_name}:latest."
  fi

  if [[ "${secret_state}" != "ENABLED" ]]; then
    fail "Required secret version is not enabled: ${secret_name}:latest."
  fi
done

printf 'preflight_project=%s\n' "${PROJECT_ID}"
printf 'preflight_required_secret_versions=%s\n' "${#REQUIRED_SECRETS[@]}"
printf 'preflight_revenuecat_enabled=%s\n' "${ENABLE_REVENUECAT}"
printf 'release_preflight=passed\n'
