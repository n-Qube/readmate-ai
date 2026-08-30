#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-billbridge-c684f}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-readmate-api}"
GCLOUD="${GCLOUD:-gcloud}"
EXTENSION_ORIGIN="${EXTENSION_ORIGIN:?Set EXTENSION_ORIGIN to the exact production chrome-extension:// origin}"
WEB_APP_ORIGIN="${WEB_APP_ORIGIN:?Set WEB_APP_ORIGIN to the exact production HTTPS web origin}"
ENABLE_REVENUECAT="${ENABLE_REVENUECAT:-false}"

if [[ "${ENABLE_REVENUECAT}" != "true" && "${ENABLE_REVENUECAT}" != "false" ]]; then
  echo "ENABLE_REVENUECAT must be exactly true or false." >&2
  exit 1
fi

"${GCLOUD}" config set project "${PROJECT_ID}"
"${GCLOUD}" services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  texttospeech.googleapis.com

if ! "${GCLOUD}" artifacts repositories describe readmate --location="${REGION}" >/dev/null 2>&1; then
  "${GCLOUD}" artifacts repositories create readmate \
    --repository-format=docker \
    --location="${REGION}" \
    --description="ReadMate AI containers"
fi

"${GCLOUD}" builds submit \
  --config cloudbuild.yaml \
  --substitutions="_REGION=${REGION},_EXTENSION_ORIGIN=${EXTENSION_ORIGIN},_WEB_APP_ORIGIN=${WEB_APP_ORIGIN},_ENABLE_REVENUECAT=${ENABLE_REVENUECAT}" \
  --suppress-logs

echo "Candidate build completed. Production traffic was not changed."
echo "Review the build's exact candidate evidence before running the separate promotion script."
