#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${FAKE_CURL_LOG:?FAKE_CURL_LOG is required}"
HTTP_STATUS="${FAKE_CURL_HTTP_STATUS:-200}"
OUTPUT_FILE=""
METHOD="GET"
DATA_FILE=""
URL=""

printf '%s\n' "$*" >>"${LOG_FILE}"

while (( $# > 0 )); do
  case "$1" in
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --write-out)
      shift 2
      ;;
    --request)
      METHOD="$2"
      shift 2
      ;;
    --data-binary)
      DATA_FILE="${2#@}"
      shift 2
      ;;
    http://*|https://*)
      URL="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ "${METHOD}" == "PATCH" ]]; then
  HTTP_STATUS="${FAKE_CURL_PATCH_HTTP_STATUS:-200}"
  if (( HTTP_STATUS < 400 )); then
    if [[ -n "${FAKE_CURL_BODY_LOG:-}" && -n "${DATA_FILE}" ]]; then
      cp -- "${DATA_FILE}" "${FAKE_CURL_BODY_LOG}"
    fi
    if [[ -n "${FAKE_GCLOUD_STATE:-}" ]]; then
      printf 'promoted\n' >"${FAKE_GCLOUD_STATE}"
    fi
  fi
  if [[ -n "${OUTPUT_FILE}" ]]; then
    printf '%s\n' "${FAKE_CURL_PATCH_RESPONSE_JSON:-{\"name\":\"projects/billbridge-c684f/locations/us-central1/operations/fake-operation\",\"done\":true}}" >"${OUTPUT_FILE}"
  fi
elif [[ "${URL}" == *"run.googleapis.com/v2/"*"/services/readmate-api" ]]; then
  if [[ -n "${OUTPUT_FILE}" ]]; then
    printf '%s\n' "${FAKE_CURL_SERVICE_V2_JSON:?FAKE_CURL_SERVICE_V2_JSON is required}" >"${OUTPUT_FILE}"
  fi
elif [[ "${URL}" == *"run.googleapis.com/v2/"*"/operations/"* ]]; then
  if [[ -n "${OUTPUT_FILE}" ]]; then
    printf '%s\n' "${FAKE_CURL_OPERATION_JSON:-{\"done\":true}}" >"${OUTPUT_FILE}"
  fi
elif [[ -n "${OUTPUT_FILE}" ]]; then
  printf '{"ok":true}\n' >"${OUTPUT_FILE}"
fi

printf '%s' "${HTTP_STATUS}"
if (( HTTP_STATUS >= 400 )); then
  exit 22
fi
