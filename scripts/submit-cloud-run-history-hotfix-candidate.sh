#!/usr/bin/env bash
set -euo pipefail

BASELINE_SOURCE_URI="${1:?exact production baseline gs:// object URI is required}"
BASELINE_SOURCE_GENERATION="${2:?production baseline object generation is required}"
BASELINE_ARCHIVE_SHA256="${3:?production baseline archive sha256 is required}"
SEALED_SOURCE_URI="${4:?sealed release gs:// object URI is required}"
SEALED_SOURCE_GENERATION="${5:?sealed release object generation is required}"
SEALED_ARCHIVE_SHA256="${6:?sealed release archive sha256 is required}"
RELEASE_MANIFEST_SHA256="${7:?release manifest sha256 is required}"

readonly PROJECT_ID="billbridge-c684f"
readonly BUILD_REGION="global"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CONFIG_PATH="${ROOT_DIR}/cloudbuild.history-hotfix.yaml"

GCLOUD="${GCLOUD:-gcloud}"
PYTHON="${PYTHON:-python3}"

fail() {
  echo "$*" >&2
  exit 1
}

case "${BASELINE_SOURCE_URI}" in
  gs://billbridge-c684f_cloudbuild/source/*.tgz) ;;
  *) fail "BASELINE_SOURCE_URI must use the pinned ReadMate Cloud Build source bucket." ;;
esac
[[ "${BASELINE_SOURCE_URI}" =~ ^gs://billbridge-c684f_cloudbuild/source/[A-Za-z0-9._/-]+\.tgz$ ]] || fail "BASELINE_SOURCE_URI contains prohibited characters."
case "${SEALED_SOURCE_URI}" in
  gs://billbridge-c684f_cloudbuild/history-hotfix/releases/*.tgz) ;;
  *) fail "SEALED_SOURCE_URI must use the pinned ReadMate Cloud Build bucket and history-hotfix prefix." ;;
esac
[[ "${BASELINE_SOURCE_URI}" != *"#"* && "${SEALED_SOURCE_URI}" != *"#"* ]] || fail "Source URIs must not contain generation suffixes."
[[ "${BASELINE_SOURCE_GENERATION}" =~ ^[1-9][0-9]*$ ]] || fail "BASELINE_SOURCE_GENERATION must be a positive integer."
[[ "${SEALED_SOURCE_GENERATION}" =~ ^[1-9][0-9]*$ ]] || fail "SEALED_SOURCE_GENERATION must be a positive integer."
[[ "${BASELINE_ARCHIVE_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "BASELINE_ARCHIVE_SHA256 must be a lowercase sha256."
[[ "${SEALED_ARCHIVE_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "SEALED_ARCHIVE_SHA256 must be a lowercase sha256."
[[ "${RELEASE_MANIFEST_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "RELEASE_MANIFEST_SHA256 must be a lowercase sha256."
[[ -f "${CONFIG_PATH}" ]] || fail "History hotfix Cloud Build config is missing: ${CONFIG_PATH}"
EXPECTED_SEALED_URI="gs://billbridge-c684f_cloudbuild/history-hotfix/releases/${SEALED_ARCHIVE_SHA256}/source.tgz"
[[ "${SEALED_SOURCE_URI}" == "${EXPECTED_SEALED_URI}" ]] || fail "SEALED_SOURCE_URI must be content-addressed by SEALED_ARCHIVE_SHA256."

# Snapshot the build definition before hashing it. The exact private snapshot
# whose digest is approved below is the only config file submitted, so edits to
# the workspace copy cannot change an already-authorized build.
umask 077
CONFIG_SNAPSHOT_DIR="$(mktemp -d)"
trap 'rm -rf "${CONFIG_SNAPSHOT_DIR}"' EXIT
readonly CONFIG_SNAPSHOT="${CONFIG_SNAPSHOT_DIR}/cloudbuild.history-hotfix.yaml"
cp -- "${CONFIG_PATH}" "${CONFIG_SNAPSHOT}"

CONFIG_SHA256="$(${PYTHON} -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "${CONFIG_SNAPSHOT}")"
if [[ "${CONFIRM_CONFIG_SHA256:-}" != "${CONFIG_SHA256}" ]]; then
  fail "Set CONFIRM_CONFIG_SHA256 to ${CONFIG_SHA256} to authorize this exact no-source candidate build configuration."
fi

printf 'cloudbuild_config=%s\n' "${CONFIG_PATH}"
printf 'cloudbuild_config_snapshot=%s\n' "${CONFIG_SNAPSHOT}"
printf 'cloudbuild_config_sha256=%s\n' "${CONFIG_SHA256}"
printf 'baseline_source_uri=%s\n' "${BASELINE_SOURCE_URI}"
printf 'baseline_source_generation=%s\n' "${BASELINE_SOURCE_GENERATION}"
printf 'baseline_archive_sha256=%s\n' "${BASELINE_ARCHIVE_SHA256}"
printf 'sealed_release_source_uri=%s\n' "${SEALED_SOURCE_URI}"
printf 'sealed_release_source_generation=%s\n' "${SEALED_SOURCE_GENERATION}"
printf 'sealed_release_archive_sha256=%s\n' "${SEALED_ARCHIVE_SHA256}"
printf 'release_manifest_sha256=%s\n' "${RELEASE_MANIFEST_SHA256}"
printf 'candidate_release_gate=no_source_no_traffic\n'

"${GCLOUD}" builds submit \
  --project="${PROJECT_ID}" \
  --region="${BUILD_REGION}" \
  --no-source \
  --config="${CONFIG_SNAPSHOT}" \
  --substitutions="_BASELINE_SOURCE_URI=${BASELINE_SOURCE_URI},_BASELINE_SOURCE_GENERATION=${BASELINE_SOURCE_GENERATION},_BASELINE_ARCHIVE_SHA256=${BASELINE_ARCHIVE_SHA256},_SEALED_RELEASE_SOURCE_URI=${SEALED_SOURCE_URI},_SEALED_RELEASE_SOURCE_GENERATION=${SEALED_SOURCE_GENERATION},_SEALED_RELEASE_ARCHIVE_SHA256=${SEALED_ARCHIVE_SHA256},_EXPECTED_RELEASE_MANIFEST_SHA256=${RELEASE_MANIFEST_SHA256}"
