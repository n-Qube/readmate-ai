#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-billbridge-c684f}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-readmate-api}"
GCLOUD="${GCLOUD:-/opt/homebrew/share/google-cloud-sdk/bin/gcloud}"

SERVICE_JSON="$("${GCLOUD}" run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format=json)"
SERVICE_URL="$(printf '%s' "${SERVICE_JSON}" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => process.stdout.write(JSON.parse(data).status.url));')"
SECRET="$(printf '%s' "${SERVICE_JSON}" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const env = JSON.parse(data).spec.template.spec.containers[0].env || []; const item = env.find((entry) => entry.name === "CRON_SECRET"); if (!item?.value) process.exit(2); process.stdout.write(item.value); });')"

curl -fsS -X POST -H "x-cron-secret: ${SECRET}" "${SERVICE_URL}/api/cron/rss-refresh"
printf '\n'
