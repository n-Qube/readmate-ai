#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-billbridge-c684f}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-readmate-api}"
SCHEDULE="${SCHEDULE:-*/30 * * * *}"
TIME_ZONE="${TIME_ZONE:-Africa/Accra}"
JOB_NAME="${JOB_NAME:-readmate-rss-refresh}"
GCLOUD="${GCLOUD:-/opt/homebrew/share/google-cloud-sdk/bin/gcloud}"

"${GCLOUD}" config set project "${PROJECT_ID}" >/dev/null
"${GCLOUD}" services enable cloudscheduler.googleapis.com --project "${PROJECT_ID}" >/dev/null

SERVICE_URL="$("${GCLOUD}" run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
if [[ -z "${SERVICE_URL}" ]]; then
  echo "Could not resolve Cloud Run service URL for ${SERVICE_NAME}." >&2
  exit 1
fi

SECRET="${CRON_SECRET:-$("${GCLOUD}" secrets versions access latest --secret readmate-cron-secret --project "${PROJECT_ID}")}"
if [[ -z "${SECRET}" ]]; then
  echo "The readmate-cron-secret Secret Manager value is empty." >&2
  exit 1
fi

if "${GCLOUD}" scheduler jobs describe "${JOB_NAME}" --project "${PROJECT_ID}" --location "${REGION}" >/dev/null 2>&1; then
  "${GCLOUD}" scheduler jobs update http "${JOB_NAME}" \
    --project "${PROJECT_ID}" \
    --location "${REGION}" \
    --schedule "${SCHEDULE}" \
    --time-zone "${TIME_ZONE}" \
    --uri "${SERVICE_URL}/api/cron/rss-refresh" \
    --http-method POST \
    --headers "x-cron-secret=${SECRET}" \
    --quiet >/dev/null
else
  "${GCLOUD}" scheduler jobs create http "${JOB_NAME}" \
    --project "${PROJECT_ID}" \
    --location "${REGION}" \
    --schedule "${SCHEDULE}" \
    --time-zone "${TIME_ZONE}" \
    --uri "${SERVICE_URL}/api/cron/rss-refresh" \
    --http-method POST \
    --headers "x-cron-secret=${SECRET}" \
    --quiet >/dev/null
fi

"${GCLOUD}" scheduler jobs describe "${JOB_NAME}" \
  --project "${PROJECT_ID}" \
  --location "${REGION}" \
  --format='table(name,state,schedule,timeZone,httpTarget.uri)'
