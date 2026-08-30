#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${FAKE_GCLOUD_LOG:?FAKE_GCLOUD_LOG is required}"
STATE_FILE="${FAKE_GCLOUD_STATE:?FAKE_GCLOUD_STATE is required}"

printf '%s\n' "$*" >>"${LOG_FILE}"

case "$1 $2 $3" in
  "auth print-access-token "*)
    printf '%s\n' "${FAKE_GCLOUD_ACCESS_TOKEN:-fake-readmate-access-token}"
    ;;
  "builds submit "*)
    printf '{"id":"history-hotfix-build"}\n'
    ;;
  "storage cp "*)
    source_uri="$3"
    destination="$4"
    if [[ "${source_uri}" == "${FAKE_BASELINE_SOURCE_URI:-}#${FAKE_BASELINE_SOURCE_GENERATION:-}" ]]; then
      cp "${FAKE_BASELINE_ARCHIVE:?FAKE_BASELINE_ARCHIVE is required}" "${destination}"
    elif [[ "${source_uri}" == "${FAKE_RELEASE_SOURCE_URI:-}#${FAKE_RELEASE_SOURCE_GENERATION:-}" ]]; then
      cp "${FAKE_RELEASE_ARCHIVE:?FAKE_RELEASE_ARCHIVE is required}" "${destination}"
    else
      echo "Unexpected fake storage source: ${source_uri}" >&2
      exit 64
    fi
    ;;
  "artifacts docker images")
    [[ "$4" == "describe" ]] || exit 64
    printf '%s\n' "${FAKE_ARTIFACT_JSON:?FAKE_ARTIFACT_JSON is required}"
    ;;
  "run deploy "*)
    printf 'deployed\n' >"${STATE_FILE}"
    printf '{}\n'
    ;;
  "run services describe")
    if [[ "$(<"${STATE_FILE}")" == "promoted" ]]; then
      printf '%s\n' "${FAKE_SERVICE_JSON_PROMOTED:?FAKE_SERVICE_JSON_PROMOTED is required after promotion}"
    elif [[ -s "${STATE_FILE}" ]]; then
      printf '%s\n' "${FAKE_SERVICE_JSON_AFTER:?FAKE_SERVICE_JSON_AFTER is required after deployment}"
    else
      printf '%s\n' "${FAKE_SERVICE_JSON_BEFORE:?FAKE_SERVICE_JSON_BEFORE is required}"
    fi
    ;;
  "run revisions describe")
    if [[ "$4" == "${FAKE_BASE_REVISION_NAME:?FAKE_BASE_REVISION_NAME is required}" ]]; then
      printf '%s\n' "${FAKE_BASE_REVISION_JSON:?FAKE_BASE_REVISION_JSON is required}"
    else
      printf '%s\n' "${FAKE_CANDIDATE_REVISION_JSON:?FAKE_CANDIDATE_REVISION_JSON is required}"
    fi
    ;;
  "run services update-traffic")
    printf 'promoted\n' >"${STATE_FILE}"
    printf '{}\n'
    ;;
  *)
    echo "Unexpected fake gcloud command: $*" >&2
    exit 64
    ;;
esac
