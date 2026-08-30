#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${FAKE_GCLOUD_LOG:?FAKE_GCLOUD_LOG is required}"
STATE_FILE="${FAKE_GCLOUD_STATE:?FAKE_GCLOUD_STATE is required}"

printf '%s\n' "$*" >>"${LOG_FILE}"

case "$1 $2 $3 $4" in
  "secrets versions describe latest")
    secret_name=""
    for argument in "$@"; do
      case "${argument}" in
        --secret=*) secret_name="${argument#--secret=}" ;;
      esac
    done
    [[ -n "${secret_name}" ]] || {
      echo "Fake Secret Manager describe requires --secret." >&2
      exit 64
    }
    if [[ "${secret_name}" == "${FAKE_UNAVAILABLE_SECRET:-}" ]]; then
      exit 1
    fi
    if [[ "${secret_name}" == "${FAKE_DISABLED_SECRET:-}" ]]; then
      printf 'DISABLED\n'
    else
      printf 'ENABLED\n'
    fi
    ;;
  "artifacts docker images describe")
    printf '%s\n' "${FAKE_ARTIFACT_JSON:?FAKE_ARTIFACT_JSON is required}"
    ;;
  "run deploy "*)
    printf '{}\n'
    ;;
  "run services describe "*)
    if [[ -s "${STATE_FILE}" ]]; then
      printf '%s\n' "${FAKE_SERVICE_JSON_AFTER:?FAKE_SERVICE_JSON_AFTER is required after promotion}"
    else
      printf '%s\n' "${FAKE_SERVICE_JSON_BEFORE:?FAKE_SERVICE_JSON_BEFORE is required}"
    fi
    ;;
  "run revisions describe "*)
    printf '%s\n' "${FAKE_REVISION_JSON:?FAKE_REVISION_JSON is required}"
    ;;
  "run services update-traffic "*)
    printf 'promoted\n' >"${STATE_FILE}"
    printf '{}\n'
    ;;
  *)
    echo "Unexpected fake gcloud command: $*" >&2
    exit 64
    ;;
esac
