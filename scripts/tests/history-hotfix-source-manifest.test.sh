#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST_TOOL="${ROOT_DIR}/scripts/history_hotfix_source_manifest.py"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

BASELINE_ROOT="${TEMP_DIR}/baseline"
RELEASE_ROOT="${TEMP_DIR}/release"
ARCHIVE_PATH="${TEMP_DIR}/production-source.tgz"
SEALED_ARCHIVE_ONE="${TEMP_DIR}/history-hotfix-source-1.tgz"
SEALED_ARCHIVE_TWO="${TEMP_DIR}/history-hotfix-source-2.tgz"
MANIFEST_PATH="${RELEASE_ROOT}/history-hotfix-release-manifest.json"
SOURCE_URI="gs://billbridge-c684f_cloudbuild/source/example.tgz"
SOURCE_GENERATION="1787962489770532"

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

write_file "${BASELINE_ROOT}" "apps/api/src/routes/documents.ts" "old route"
write_file "${BASELINE_ROOT}" "apps/api/src/routes/documents.test.ts" "old tests"
write_file "${BASELINE_ROOT}" "apps/api/package.json" "api package"
write_file "${BASELINE_ROOT}" "Dockerfile" "runtime image"
write_file "${BASELINE_ROOT}" "package-lock.json" "dependency lock"

COPYFILE_DISABLE=1 tar -czf "${ARCHIVE_PATH}" -C "${BASELINE_ROOT}" .
ARCHIVE_SHA256="$(sha256_file "${ARCHIVE_PATH}")"

cp -R "${BASELINE_ROOT}/." "${RELEASE_ROOT}/"
write_file "${RELEASE_ROOT}" "apps/api/src/routes/documents.ts" "history-only route"
write_file "${RELEASE_ROOT}" "apps/api/src/routes/documents.test.ts" "history-only tests"
write_file "${RELEASE_ROOT}" "scripts/deploy-cloud-run-history-hotfix-candidate.sh" "no traffic"

PREPARE_OUTPUT="$(
  python3 "${MANIFEST_TOOL}" prepare \
    --release-root "${RELEASE_ROOT}" \
    --baseline-archive "${ARCHIVE_PATH}" \
    --baseline-source-uri "${SOURCE_URI}" \
    --baseline-source-generation "${SOURCE_GENERATION}" \
    --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}"
)"

MANIFEST_SHA256="$(printf '%s\n' "${PREPARE_OUTPUT}" | awk -F= '$1 == "release_manifest_sha256" {print $2}')"
[[ "${MANIFEST_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "prepare did not emit a manifest sha256"

VERIFY_OUTPUT="$(
  python3 "${MANIFEST_TOOL}" verify \
    --root "${RELEASE_ROOT}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-baseline-source-uri "${SOURCE_URI}" \
    --expected-baseline-source-generation "${SOURCE_GENERATION}" \
    --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}"
)"
[[ "${VERIFY_OUTPUT}" == *"source_isolation=verified"* ]] || fail "valid source manifest was not verified"

SEAL_OUTPUT_ONE="$(
  python3 "${MANIFEST_TOOL}" seal \
    --root "${RELEASE_ROOT}" \
    --output "${SEALED_ARCHIVE_ONE}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-baseline-source-uri "${SOURCE_URI}" \
    --expected-baseline-source-generation "${SOURCE_GENERATION}" \
    --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}"
)"
SEALED_SHA256_ONE="$(printf '%s\n' "${SEAL_OUTPUT_ONE}" | awk -F= '$1 == "sealed_release_archive_sha256" {print $2}')"
[[ "${SEALED_SHA256_ONE}" =~ ^[0-9a-f]{64}$ ]] || fail "seal did not emit an archive sha256"

SEAL_OUTPUT_TWO="$(
  python3 "${MANIFEST_TOOL}" seal \
    --root "${RELEASE_ROOT}" \
    --output "${SEALED_ARCHIVE_TWO}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-baseline-source-uri "${SOURCE_URI}" \
    --expected-baseline-source-generation "${SOURCE_GENERATION}" \
    --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}"
)"
SEALED_SHA256_TWO="$(printf '%s\n' "${SEAL_OUTPUT_TWO}" | awk -F= '$1 == "sealed_release_archive_sha256" {print $2}')"
[[ "${SEALED_SHA256_ONE}" == "${SEALED_SHA256_TWO}" ]] || fail "sealed archive is not deterministic"

# A source mutation after verify but before archive creation must be detected
# against the manifest's already-approved release tree.
python3 - "${MANIFEST_TOOL}" "${RELEASE_ROOT}" "${TEMP_DIR}/raced-release.tgz" \
  "${MANIFEST_SHA256}" "${SOURCE_URI}" "${SOURCE_GENERATION}" "${ARCHIVE_SHA256}" <<'PY'
import argparse
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location("history_manifest", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_write = module.write_deterministic_archive

def mutate_then_write(root, output_path, manifest_name):
    target = pathlib.Path(root) / "apps/api/src/post-verify-mutation.ts"
    target.write_text("must fail\n", encoding="utf-8")
    try:
        original_write(root, output_path, manifest_name)
    finally:
        target.unlink(missing_ok=True)

module.write_deterministic_archive = mutate_then_write
args = argparse.Namespace(
    root=sys.argv[2],
    output=sys.argv[3],
    expected_manifest_sha256=sys.argv[4],
    expected_baseline_source_uri=sys.argv[5],
    expected_baseline_source_generation=sys.argv[6],
    expected_baseline_archive_sha256=sys.argv[7],
    manifest_name=module.DEFAULT_MANIFEST_NAME,
)
try:
    module.seal(args)
except module.ManifestError as error:
    if "sealed release archive tree mismatch" not in str(error):
        raise
else:
    raise SystemExit("seal accepted a post-verification source mutation")
PY

# An extra file after manifest preparation changes the submitted tree and must fail.
write_file "${RELEASE_ROOT}" "apps/api/src/unrelated-feature.ts" "must not ship"
if python3 "${MANIFEST_TOOL}" verify \
  --root "${RELEASE_ROOT}" \
  --expected-manifest-sha256 "${MANIFEST_SHA256}" \
  --expected-baseline-source-uri "${SOURCE_URI}" \
  --expected-baseline-source-generation "${SOURCE_GENERATION}" \
  --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}" \
  >"${TEMP_DIR}/extra-file.out" 2>&1; then
  fail "source verification accepted an extra release file"
fi
grep -q "submitted source tree sha256 mismatch" "${TEMP_DIR}/extra-file.out"
rm "${RELEASE_ROOT}/apps/api/src/unrelated-feature.ts"

# The externally recorded manifest digest cannot be silently replaced.
if python3 "${MANIFEST_TOOL}" verify \
  --root "${RELEASE_ROOT}" \
  --expected-manifest-sha256 "$(printf '0%.0s' {1..64})" \
  --expected-baseline-source-uri "${SOURCE_URI}" \
  --expected-baseline-source-generation "${SOURCE_GENERATION}" \
  --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}" \
  >"${TEMP_DIR}/wrong-manifest.out" 2>&1; then
  fail "source verification accepted the wrong manifest digest"
fi
grep -q "release manifest sha256 mismatch" "${TEMP_DIR}/wrong-manifest.out"

# Baseline provenance is independently supplied to Cloud Build and must match.
if python3 "${MANIFEST_TOOL}" verify \
  --root "${RELEASE_ROOT}" \
  --expected-manifest-sha256 "${MANIFEST_SHA256}" \
  --expected-baseline-source-uri "gs://billbridge-c684f_cloudbuild/source/other.tgz" \
  --expected-baseline-source-generation "${SOURCE_GENERATION}" \
  --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}" \
  >"${TEMP_DIR}/wrong-baseline.out" 2>&1; then
  fail "source verification accepted different baseline provenance"
fi
grep -q "baselineSourceUri does not match" "${TEMP_DIR}/wrong-baseline.out"

# Preparation itself rejects any change outside the approved hotfix paths.
write_file "${RELEASE_ROOT}" "apps/api/src/unrelated-feature.ts" "must not ship"
if python3 "${MANIFEST_TOOL}" prepare \
  --release-root "${RELEASE_ROOT}" \
  --baseline-archive "${ARCHIVE_PATH}" \
  --baseline-source-uri "${SOURCE_URI}" \
  --baseline-source-generation "${SOURCE_GENERATION}" \
  --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}" \
  >"${TEMP_DIR}/wrong-scope.out" 2>&1; then
  fail "manifest preparation accepted an unrelated changed file"
fi
grep -q "unexpectedChangedFiles" "${TEMP_DIR}/wrong-scope.out"

# The preparation baseline must come from the verified archive, not from an
# independently supplied directory that could be tampered with.
rm "${RELEASE_ROOT}/apps/api/src/unrelated-feature.ts"
write_file "${BASELINE_ROOT}" "apps/api/src/routes/documents.ts" "tampered local baseline"
PREPARE_AFTER_LOCAL_TAMPER="$(
  python3 "${MANIFEST_TOOL}" prepare \
    --release-root "${RELEASE_ROOT}" \
    --baseline-archive "${ARCHIVE_PATH}" \
    --baseline-source-uri "${SOURCE_URI}" \
    --baseline-source-generation "${SOURCE_GENERATION}" \
    --expected-baseline-archive-sha256 "${ARCHIVE_SHA256}"
)"
[[ "${PREPARE_AFTER_LOCAL_TAMPER}" == *"source_isolation=exact_baseline_plus_allowlist_only"* ]] \
  || fail "prepare did not derive its baseline directly from the verified archive"

# Unsafe archive paths fail closed before any diff is evaluated.
MALICIOUS_ARCHIVE="${TEMP_DIR}/malicious.tgz"
python3 -c 'import io, tarfile, sys; archive=tarfile.open(sys.argv[1], "w:gz"); info=tarfile.TarInfo("../escape"); payload=b"escape"; info.size=len(payload); archive.addfile(info, io.BytesIO(payload)); archive.close()' "${MALICIOUS_ARCHIVE}"
MALICIOUS_SHA256="$(sha256_file "${MALICIOUS_ARCHIVE}")"
if python3 "${MANIFEST_TOOL}" prepare \
  --release-root "${RELEASE_ROOT}" \
  --baseline-archive "${MALICIOUS_ARCHIVE}" \
  --baseline-source-uri "${SOURCE_URI}" \
  --baseline-source-generation "${SOURCE_GENERATION}" \
  --expected-baseline-archive-sha256 "${MALICIOUS_SHA256}" \
  >"${TEMP_DIR}/unsafe-archive.out" 2>&1; then
  fail "manifest preparation accepted an unsafe archive member"
fi
grep -q "escapes the extraction root" "${TEMP_DIR}/unsafe-archive.out"

printf 'history hotfix source manifest regression test: PASS\n'
