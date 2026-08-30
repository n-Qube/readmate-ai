#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

BASELINE_ROOT="${TEMP_DIR}/baseline"
RELEASE_ROOT="${TEMP_DIR}/release"
BASELINE_ARCHIVE="${TEMP_DIR}/baseline.tgz"
SEALED_ARCHIVE="${TEMP_DIR}/sealed-release.tgz"
TAMPERED_ROOT="${TEMP_DIR}/tampered-release"
TAMPERED_ARCHIVE="${TEMP_DIR}/tampered-release.tgz"
FETCH_SCRIPT_RAW="${TEMP_DIR}/fetch-source-gate.raw.sh"
VERIFY_SCRIPT_RAW="${TEMP_DIR}/verify-source-gate.raw.sh"
STEP_SCRIPT="${TEMP_DIR}/source-gate.sh"
FAKE_BIN="${TEMP_DIR}/bin"
GCLOUD_LOG="${TEMP_DIR}/gcloud.log"
STATE_FILE="${TEMP_DIR}/state"
MANIFEST_TOOL="${ROOT_DIR}/scripts/history_hotfix_source_manifest.py"
BASELINE_URI="gs://billbridge-c684f_cloudbuild/source/production.tgz"
BASELINE_GENERATION="1787962489770532"

fail() {
  echo "$*" >&2
  exit 1
}

sha256_file() {
  python3 -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$1"
}

write_file() {
  local root="$1"
  local path="$2"
  local value="$3"
  mkdir -p "${root}/$(dirname "${path}")"
  printf '%s\n' "${value}" >"${root}/${path}"
}

mkdir -p "${BASELINE_ROOT}" "${FAKE_BIN}"
write_file "${BASELINE_ROOT}" "Dockerfile" "runtime image"
write_file "${BASELINE_ROOT}" "package-lock.json" "dependency lock"
write_file "${BASELINE_ROOT}" "apps/api/package.json" "api package"
write_file "${BASELINE_ROOT}" "apps/api/src/routes/documents.ts" "old route"
write_file "${BASELINE_ROOT}" "apps/api/src/routes/documents.test.ts" "old tests"
COPYFILE_DISABLE=1 tar -czf "${BASELINE_ARCHIVE}" -C "${BASELINE_ROOT}" .
BASELINE_SHA256="$(sha256_file "${BASELINE_ARCHIVE}")"

cp -R "${BASELINE_ROOT}/." "${RELEASE_ROOT}/"
write_file "${RELEASE_ROOT}" "apps/api/src/routes/documents.ts" "history-only route"
write_file "${RELEASE_ROOT}" "apps/api/src/routes/documents.test.ts" "history-only tests"
write_file "${RELEASE_ROOT}" "scripts/deploy-cloud-run-history-hotfix-candidate.sh" "no traffic"

PREPARE_OUTPUT="$(
  python3 "${MANIFEST_TOOL}" prepare \
    --release-root "${RELEASE_ROOT}" \
    --baseline-archive "${BASELINE_ARCHIVE}" \
    --baseline-source-uri "${BASELINE_URI}" \
    --baseline-source-generation "${BASELINE_GENERATION}" \
    --expected-baseline-archive-sha256 "${BASELINE_SHA256}"
)"
MANIFEST_SHA256="$(printf '%s\n' "${PREPARE_OUTPUT}" | awk -F= '$1 == "release_manifest_sha256" {print $2}')"

SEAL_OUTPUT="$(
  python3 "${MANIFEST_TOOL}" seal \
    --root "${RELEASE_ROOT}" \
    --output "${SEALED_ARCHIVE}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-baseline-source-uri "${BASELINE_URI}" \
    --expected-baseline-source-generation "${BASELINE_GENERATION}" \
    --expected-baseline-archive-sha256 "${BASELINE_SHA256}"
)"
SEALED_SHA256="$(printf '%s\n' "${SEAL_OUTPUT}" | awk -F= '$1 == "sealed_release_archive_sha256" {print $2}')"
SEALED_URI="gs://billbridge-c684f_cloudbuild/history-hotfix/releases/${SEALED_SHA256}/source.tgz"
SEALED_GENERATION="1788000000000000"

extract_step_script() {
  local step_id="$1"
  awk -v step_id="${step_id}" '
    $0 == "  - id: " step_id { in_step = 1; next }
    in_step && /^      - \|$/ { capture = 1; next }
    capture && /^  - id:/ { exit }
    capture { sub(/^        /, ""); print }
  ' "${ROOT_DIR}/cloudbuild.history-hotfix.yaml"
}

extract_step_script fetch-generation-locked-sealed-release >"${FETCH_SCRIPT_RAW}"
extract_step_script verify-generation-locked-sealed-release >"${VERIFY_SCRIPT_RAW}"
sed 's/\$\$/\$/g' "${FETCH_SCRIPT_RAW}" "${VERIFY_SCRIPT_RAW}" >"${STEP_SCRIPT}"
chmod +x "${STEP_SCRIPT}"
ln -s "${ROOT_DIR}/scripts/tests/fixtures/fake-gcloud-history-hotfix.sh" "${FAKE_BIN}/gcloud"
touch "${GCLOUD_LOG}" "${STATE_FILE}"

GOOD_WORKSPACE="${TEMP_DIR}/good-workspace"
GATE_OUTPUT="$(
  PATH="${FAKE_BIN}:${PATH}" \
  READMATE_BUILD_WORKSPACE="${GOOD_WORKSPACE}" \
  READMATE_BASELINE_URI="${BASELINE_URI}" \
  READMATE_BASELINE_GENERATION="${BASELINE_GENERATION}" \
  READMATE_BASELINE_SHA256="${BASELINE_SHA256}" \
  READMATE_RELEASE_URI="${SEALED_URI}" \
  READMATE_RELEASE_GENERATION="${SEALED_GENERATION}" \
  READMATE_RELEASE_SHA256="${SEALED_SHA256}" \
  READMATE_MANIFEST_SHA256="${MANIFEST_SHA256}" \
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_BASELINE_SOURCE_URI="${BASELINE_URI}" \
  FAKE_BASELINE_SOURCE_GENERATION="${BASELINE_GENERATION}" \
  FAKE_BASELINE_ARCHIVE="${BASELINE_ARCHIVE}" \
  FAKE_RELEASE_SOURCE_URI="${SEALED_URI}" \
  FAKE_RELEASE_SOURCE_GENERATION="${SEALED_GENERATION}" \
  FAKE_RELEASE_ARCHIVE="${SEALED_ARCHIVE}" \
  bash -euo pipefail "${STEP_SCRIPT}"
)"
[[ "${GATE_OUTPUT}" == *"source_isolation=generation-locked-baseline-and-sealed-release"* ]] \
  || fail "Cloud Build source gate did not verify valid generation-locked archives"
diff -r "${RELEASE_ROOT}" "${GOOD_WORKSPACE}/release" >/dev/null \
  || fail "Cloud Build source gate materialized a different release tree"

# Even if a tampered archive has its own externally supplied SHA, the trusted
# build definition must independently reject the extra self-verifier file.
cp -R "${RELEASE_ROOT}/." "${TAMPERED_ROOT}/"
write_file "${TAMPERED_ROOT}" "scripts/history_hotfix_source_manifest.py" "raise SystemExit(0)"
COPYFILE_DISABLE=1 tar -czf "${TAMPERED_ARCHIVE}" -C "${TAMPERED_ROOT}" .
TAMPERED_SHA256="$(sha256_file "${TAMPERED_ARCHIVE}")"
TAMPERED_URI="gs://billbridge-c684f_cloudbuild/history-hotfix/releases/${TAMPERED_SHA256}/source.tgz"
TAMPERED_WORKSPACE="${TEMP_DIR}/tampered-workspace"

if PATH="${FAKE_BIN}:${PATH}" \
  READMATE_BUILD_WORKSPACE="${TAMPERED_WORKSPACE}" \
  READMATE_BASELINE_URI="${BASELINE_URI}" \
  READMATE_BASELINE_GENERATION="${BASELINE_GENERATION}" \
  READMATE_BASELINE_SHA256="${BASELINE_SHA256}" \
  READMATE_RELEASE_URI="${TAMPERED_URI}" \
  READMATE_RELEASE_GENERATION="${SEALED_GENERATION}" \
  READMATE_RELEASE_SHA256="${TAMPERED_SHA256}" \
  READMATE_MANIFEST_SHA256="${MANIFEST_SHA256}" \
  FAKE_GCLOUD_LOG="${GCLOUD_LOG}" \
  FAKE_GCLOUD_STATE="${STATE_FILE}" \
  FAKE_BASELINE_SOURCE_URI="${BASELINE_URI}" \
  FAKE_BASELINE_SOURCE_GENERATION="${BASELINE_GENERATION}" \
  FAKE_BASELINE_ARCHIVE="${BASELINE_ARCHIVE}" \
  FAKE_RELEASE_SOURCE_URI="${TAMPERED_URI}" \
  FAKE_RELEASE_SOURCE_GENERATION="${SEALED_GENERATION}" \
  FAKE_RELEASE_ARCHIVE="${TAMPERED_ARCHIVE}" \
  bash -euo pipefail "${STEP_SCRIPT}" >"${TEMP_DIR}/tampered-gate.out" 2>&1; then
  fail "Cloud Build source gate accepted a tampered self-verifier"
fi
grep -q "outside the exact history hotfix scope" "${TEMP_DIR}/tampered-gate.out"

printf 'cloudbuild history hotfix source gate regression test: PASS\n'
