#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="${ROOT_DIR}/scripts/api_release_source_manifest.py"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

fail() {
  echo "$*" >&2
  exit 1
}

sha256_file() {
  python3 -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$1"
}

write_file() {
  local root="$1"
  local relative="$2"
  local value="$3"
  mkdir -p "${root}/$(dirname "${relative}")"
  printf '%s\n' "${value}" >"${root}/${relative}"
}

make_source() {
  local root="$1"
  write_file "${root}" ".dockerignore" "node_modules"
  write_file "${root}" "Dockerfile" "FROM node:22-slim"
  write_file "${root}" "cloudbuild.yaml" "steps: []"
  write_file "${root}" "package.json" '{"name":"fixture","private":true}'
  write_file "${root}" "package-lock.json" '{"name":"fixture","lockfileVersion":3,"packages":{}}'
  write_file "${root}" "tsconfig.base.json" '{"compilerOptions":{}}'
  write_file "${root}" "scripts/deploy-cloud-run-candidate.sh" "#!/usr/bin/env bash"
  write_file "${root}" "scripts/patch-expo-modules-jsi-xcode27.cjs" "process.exitCode = 0;"
  write_file "${root}" "scripts/preflight-cloud-run-release.sh" "#!/usr/bin/env bash"
  chmod 0755 \
    "${root}/scripts/deploy-cloud-run-candidate.sh" \
    "${root}/scripts/preflight-cloud-run-release.sh"

  write_file "${root}" "apps/api/package.json" '{"name":"@readmate/api"}'
  write_file "${root}" "apps/api/tsconfig.json" '{"extends":"../../tsconfig.base.json"}'
  write_file "${root}" "apps/api/vitest.config.ts" 'export default {};'
  write_file "${root}" "apps/api/src/server.ts" 'console.log("server");'
  write_file "${root}" "apps/api/src/app.test.ts" 'export const testValue = true;'
  write_file "${root}" "apps/api/prisma/schema.prisma" 'generator client { provider = "prisma-client-js" }'
  write_file "${root}" "apps/mobile/public/challenge-feed.xml" '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'
  write_file \
    "${root}" \
    "apps/api/prisma/migrations/20260829150000_account_deletion_fence/migration.sql" \
    'SELECT 1;'

  # These files exist in the working checkout but are deliberately excluded
  # from the Cloud Run release source.
  write_file "${root}" "README.md" "unrelated root documentation"
  write_file "${root}" "apps/api/.env" "DATABASE_URL=must-not-ship"
  write_file "${root}" "apps/api/api/index.ts" "export default {};"
  write_file "${root}" "apps/api/vercel.json" '{}'
  write_file "${root}" "apps/api/dist/server.js" "generated"
  write_file "${root}" "apps/api/node_modules/example/package.json" '{}'
  write_file "${root}" "apps/api/.cache/state.cache" "generated"
  write_file "${root}" "apps/api/debug.log" "generated"
}

expect_failure() {
  local expected="$1"
  local output="$2"
  shift 2
  if "$@" >"${output}" 2>&1; then
    fail "command unexpectedly succeeded; expected: ${expected}"
  fi
  grep -q "${expected}" "${output}" || {
    cat "${output}" >&2
    fail "failure did not contain expected text: ${expected}"
  }
}

SOURCE_ROOT="${TEMP_DIR}/source"
RELEASE_ROOT="${TEMP_DIR}/release"
MANIFEST_PATH="${TEMP_DIR}/release-manifest.json"
ARCHIVE_ONE="${TEMP_DIR}/readmate-api-release-1.tgz"
ARCHIVE_TWO="${TEMP_DIR}/readmate-api-release-2.tgz"
make_source "${SOURCE_ROOT}"

PREPARE_OUTPUT="$(${TOOL} prepare \
  --source-root "${SOURCE_ROOT}" \
  --release-root "${RELEASE_ROOT}" \
  --manifest "${MANIFEST_PATH}")"
MANIFEST_SHA256="$(printf '%s\n' "${PREPARE_OUTPUT}" | awk -F= '$1 == "release_manifest_sha256" {print $2}')"
TREE_SHA256="$(printf '%s\n' "${PREPARE_OUTPUT}" | awk -F= '$1 == "release_source_tree_sha256" {print $2}')"
[[ "${MANIFEST_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "prepare did not emit a manifest SHA-256"
[[ "${TREE_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "prepare did not emit a tree SHA-256"
[[ "${PREPARE_OUTPUT}" == *"release_source_gate=prepared"* ]] || fail "prepare gate did not pass"

VERIFY_OUTPUT="$(${TOOL} verify \
  --root "${RELEASE_ROOT}" \
  --manifest "${MANIFEST_PATH}" \
  --expected-manifest-sha256 "${MANIFEST_SHA256}")"
[[ "${VERIFY_OUTPUT}" == *"release_source_gate=verified"* ]] || fail "release root was not verified"

SEAL_ONE_OUTPUT="$(${TOOL} seal \
  --root "${RELEASE_ROOT}" \
  --manifest "${MANIFEST_PATH}" \
  --expected-manifest-sha256 "${MANIFEST_SHA256}" \
  --output "${ARCHIVE_ONE}")"
ARCHIVE_SHA256="$(printf '%s\n' "${SEAL_ONE_OUTPUT}" | awk -F= '$1 == "sealed_release_archive_sha256" {print $2}')"
[[ "${ARCHIVE_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "seal did not emit an archive SHA-256"

SEAL_TWO_OUTPUT="$(${TOOL} seal \
  --root "${RELEASE_ROOT}" \
  --manifest "${MANIFEST_PATH}" \
  --expected-manifest-sha256 "${MANIFEST_SHA256}" \
  --output "${ARCHIVE_TWO}")"
ARCHIVE_SHA256_TWO="$(printf '%s\n' "${SEAL_TWO_OUTPUT}" | awk -F= '$1 == "sealed_release_archive_sha256" {print $2}')"
[[ "${ARCHIVE_SHA256}" == "${ARCHIVE_SHA256_TWO}" ]] || fail "sealed archives are not deterministic"

VERIFY_ARCHIVE_OUTPUT="$(${TOOL} verify-archive \
  --archive "${ARCHIVE_ONE}" \
  --manifest "${MANIFEST_PATH}" \
  --expected-manifest-sha256 "${MANIFEST_SHA256}" \
  --expected-archive-sha256 "${ARCHIVE_SHA256}")"
[[ "${VERIFY_ARCHIVE_OUTPUT}" == *"sealed_release_source=verified"* ]] \
  || fail "sealed archive was not verified"

# The manifest is external evidence and is intentionally not submitted as build source.
if tar -tzf "${ARCHIVE_ONE}" | grep -q 'release-manifest'; then
  fail "sealed archive unexpectedly contains its external manifest"
fi
for forbidden in \
  README.md \
  apps/api/.env \
  apps/api/api/index.ts \
  apps/api/vercel.json \
  apps/api/dist/server.js \
  apps/api/node_modules/example/package.json \
  apps/api/.cache/state.cache \
  apps/api/debug.log; do
  if tar -tzf "${ARCHIVE_ONE}" | grep -Fxq "${forbidden}"; then
    fail "sealed archive contains excluded file: ${forbidden}"
  fi
done

python3 - "${MANIFEST_PATH}" "${ARCHIVE_ONE}" <<'PY'
import json
import sys
import tarfile

manifest = json.load(open(sys.argv[1], encoding="utf-8"))
expected = [record["path"] for record in manifest["source"]["files"]]
with tarfile.open(sys.argv[2], "r:gz") as archive:
    actual = sorted(member.name for member in archive.getmembers())
if actual != expected:
    raise SystemExit(f"archive inventory mismatch: {actual!r} != {expected!r}")
PY

# A mutation after the seal's initial verification but before publication must
# remove the temporary artifact and leave no final archive behind.
python3 - \
  "${TOOL}" \
  "${RELEASE_ROOT}" \
  "${MANIFEST_PATH}" \
  "${MANIFEST_SHA256}" \
  "${TEMP_DIR}/raced-release.tgz" <<'PY'
import argparse
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location("api_release_source_manifest", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_write = module.write_deterministic_archive

def mutate_after_archive(root, output, records):
    original_write(root, output, records)
    (pathlib.Path(root) / "apps/api/src/server.ts").write_text(
        "mutated during seal\n", encoding="utf-8"
    )

module.write_deterministic_archive = mutate_after_archive
args = argparse.Namespace(
    root=sys.argv[2],
    manifest=sys.argv[3],
    expected_manifest_sha256=sys.argv[4],
    output=sys.argv[5],
)
try:
    module.seal(args)
except module.ReleaseGateError as error:
    if "release source tree does not match the approved manifest" not in str(error):
        raise
else:
    raise SystemExit("seal accepted source drift after its initial verification")
if pathlib.Path(sys.argv[5]).exists():
    raise SystemExit("failed seal published a final archive")
PY
cp "${SOURCE_ROOT}/apps/api/src/server.ts" "${RELEASE_ROOT}/apps/api/src/server.ts"

# Drift after manifest preparation must invalidate both verification and sealing.
printf '%s\n' 'mutated after approval' >"${RELEASE_ROOT}/apps/api/src/server.ts"
expect_failure \
  "release source tree does not match the approved manifest" \
  "${TEMP_DIR}/drift.out" \
  "${TOOL}" verify \
    --root "${RELEASE_ROOT}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}"
cp "${SOURCE_ROOT}/apps/api/src/server.ts" "${RELEASE_ROOT}/apps/api/src/server.ts"

# Extra files, sensitive files, links, and unexpected directories fail closed.
write_file "${RELEASE_ROOT}" "README.md" "must not ship"
expect_failure \
  "unrelated file" \
  "${TEMP_DIR}/unrelated.out" \
  "${TOOL}" verify \
    --root "${RELEASE_ROOT}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}"
rm "${RELEASE_ROOT}/README.md"

write_file "${RELEASE_ROOT}" "apps/api/.env.production" "SECRET=must-not-ship"
expect_failure \
  "sensitive environment path" \
  "${TEMP_DIR}/sensitive-path.out" \
  "${TOOL}" verify \
    --root "${RELEASE_ROOT}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}"
rm "${RELEASE_ROOT}/apps/api/.env.production"

mv "${RELEASE_ROOT}/apps/api/src/server.ts" "${RELEASE_ROOT}/apps/api/src/server.real.ts"
ln -s server.real.ts "${RELEASE_ROOT}/apps/api/src/server.ts"
expect_failure \
  "forbidden symbolic link" \
  "${TEMP_DIR}/release-symlink.out" \
  "${TOOL}" verify \
    --root "${RELEASE_ROOT}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}"
rm "${RELEASE_ROOT}/apps/api/src/server.ts"
mv "${RELEASE_ROOT}/apps/api/src/server.real.ts" "${RELEASE_ROOT}/apps/api/src/server.ts"

mkdir "${RELEASE_ROOT}/unrelated-empty-directory"
expect_failure \
  "directories do not match" \
  "${TEMP_DIR}/extra-directory.out" \
  "${TOOL}" verify \
    --root "${RELEASE_ROOT}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}"
rmdir "${RELEASE_ROOT}/unrelated-empty-directory"

# Preparation rejects links in selected paths, including an excluded generated-directory link.
SYMLINK_SOURCE="${TEMP_DIR}/source-symlink"
cp -R "${SOURCE_ROOT}" "${SYMLINK_SOURCE}"
rm "${SYMLINK_SOURCE}/apps/api/src/server.ts"
ln -s /etc/hosts "${SYMLINK_SOURCE}/apps/api/src/server.ts"
expect_failure \
  "forbidden symbolic link" \
  "${TEMP_DIR}/source-symlink.out" \
  "${TOOL}" prepare \
    --source-root "${SYMLINK_SOURCE}" \
    --release-root "${TEMP_DIR}/release-symlink-source" \
    --manifest "${TEMP_DIR}/manifest-symlink-source.json"

GENERATED_LINK_SOURCE="${TEMP_DIR}/source-generated-link"
cp -R "${SOURCE_ROOT}" "${GENERATED_LINK_SOURCE}"
rm -rf "${GENERATED_LINK_SOURCE}/apps/api/dist"
ln -s /etc "${GENERATED_LINK_SOURCE}/apps/api/dist"
expect_failure \
  "forbidden symbolic link" \
  "${TEMP_DIR}/generated-link.out" \
  "${TOOL}" prepare \
    --source-root "${GENERATED_LINK_SOURCE}" \
    --release-root "${TEMP_DIR}/release-generated-link" \
    --manifest "${TEMP_DIR}/manifest-generated-link.json"

# A sensitive directory component cannot hide otherwise allowed source files.
SENSITIVE_DIRECTORY_SOURCE="${TEMP_DIR}/source-sensitive-directory"
cp -R "${SOURCE_ROOT}" "${SENSITIVE_DIRECTORY_SOURCE}"
write_file \
  "${SENSITIVE_DIRECTORY_SOURCE}" \
  "apps/api/src/.env.production/config.ts" \
  'export const mustNotShip = true;'
expect_failure \
  "sensitive environment path" \
  "${TEMP_DIR}/sensitive-directory.out" \
  "${TOOL}" prepare \
    --source-root "${SENSITIVE_DIRECTORY_SOURCE}" \
    --release-root "${TEMP_DIR}/release-sensitive-directory" \
    --manifest "${TEMP_DIR}/manifest-sensitive-directory.json"

UNCLASSIFIED_SOURCE="${TEMP_DIR}/source-unclassified"
cp -R "${SOURCE_ROOT}" "${UNCLASSIFIED_SOURCE}"
write_file "${UNCLASSIFIED_SOURCE}" "apps/api/operator-notes.txt" "must be classified explicitly"
expect_failure \
  "unclassified or unrelated API file" \
  "${TEMP_DIR}/unclassified.out" \
  "${TOOL}" prepare \
    --source-root "${UNCLASSIFIED_SOURCE}" \
    --release-root "${TEMP_DIR}/release-unclassified" \
    --manifest "${TEMP_DIR}/manifest-unclassified.json"

SECRET_SOURCE="${TEMP_DIR}/source-secret"
cp -R "${SOURCE_ROOT}" "${SECRET_SOURCE}"
PRIVATE_KEY_MARKER='-----BEGIN '"PRIVATE KEY"'-----'
printf '%s\n' "${PRIVATE_KEY_MARKER}" >>"${SECRET_SOURCE}/apps/api/src/server.ts"
expect_failure \
  "sensitive content (private key material)" \
  "${TEMP_DIR}/secret-content.out" \
  "${TOOL}" prepare \
    --source-root "${SECRET_SOURCE}" \
    --release-root "${TEMP_DIR}/release-secret" \
    --manifest "${TEMP_DIR}/manifest-secret.json"
if grep -q 'BEGIN '"PRIVATE KEY" "${TEMP_DIR}/secret-content.out"; then
  fail "secret scanner echoed sensitive content"
fi

# Swapping an already-inspected parent directory to a symlink cannot redirect
# subsequent reads outside the anchored source root.
PARENT_SWAP_SOURCE="${TEMP_DIR}/source-parent-swap"
PARENT_SWAP_OUTSIDE="${TEMP_DIR}/outside-parent-swap"
cp -R "${SOURCE_ROOT}" "${PARENT_SWAP_SOURCE}"
mkdir -p "${PARENT_SWAP_OUTSIDE}"
write_file "${PARENT_SWAP_OUTSIDE}" "server.ts" 'console.log("outside");'
python3 - \
  "${TOOL}" \
  "${PARENT_SWAP_SOURCE}" \
  "${PARENT_SWAP_OUTSIDE}" \
  "${TEMP_DIR}/release-parent-swap" \
  "${TEMP_DIR}/manifest-parent-swap.json" <<'PY'
import argparse
import importlib.util
import os
import pathlib
import sys

spec = importlib.util.spec_from_file_location("api_release_source_manifest", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_select = module.selected_source_paths

def swap_parent_after_selection(root):
    paths = original_select(root)
    source = pathlib.Path(root) / "apps/api/src"
    source.rename(source.with_name("src.original"))
    os.symlink(sys.argv[3], source)
    return paths

module.selected_source_paths = swap_parent_after_selection
args = argparse.Namespace(source_root=sys.argv[2], release_root=sys.argv[4], manifest=sys.argv[5])
try:
    module.prepare(args)
except module.ReleaseGateError as error:
    if "cannot be opened safely" not in str(error):
        raise
else:
    raise SystemExit("parent-directory symlink swap escaped the source root")
PY

# The incremental size cap fires during a read, not only against the initial
# stat size, so a growing/FUSE-like file cannot cause unbounded accumulation.
python3 - "${TOOL}" "${SOURCE_ROOT}/Dockerfile" <<'PY'
import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location("api_release_source_manifest", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
descriptor = os.open(sys.argv[2], os.O_RDONLY)
original_read = module.os.read
calls = 0

def oversized_read(fd, size):
    global calls
    calls += 1
    return b"123456789012345678901" if calls == 1 else b""

module.os.read = oversized_read
try:
    module.read_stable_descriptor(descriptor, "Dockerfile", max_bytes=20)
except module.ReleaseGateError as error:
    if "grew beyond" not in str(error):
        raise
else:
    raise SystemExit("incremental file-size limit was not enforced")
finally:
    module.os.read = original_read
    os.close(descriptor)
PY

# Unsafe tar member names and archive links are rejected independently.
MALICIOUS_TRAVERSAL="${TEMP_DIR}/malicious-traversal.tgz"
python3 - "${MALICIOUS_TRAVERSAL}" <<'PY'
import io
import tarfile
import sys

with tarfile.open(sys.argv[1], "w:gz") as archive:
    payload = b"escape"
    info = tarfile.TarInfo("../escape")
    info.size = len(payload)
    archive.addfile(info, io.BytesIO(payload))
PY
TRAVERSAL_SHA="$(sha256_file "${MALICIOUS_TRAVERSAL}")"
expect_failure \
  "unsafe archive path" \
  "${TEMP_DIR}/traversal.out" \
  "${TOOL}" verify-archive \
    --archive "${MALICIOUS_TRAVERSAL}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-archive-sha256 "${TRAVERSAL_SHA}"

MALICIOUS_LINK="${TEMP_DIR}/malicious-link.tgz"
python3 - "${MALICIOUS_LINK}" <<'PY'
import tarfile
import sys

with tarfile.open(sys.argv[1], "w:gz") as archive:
    info = tarfile.TarInfo("Dockerfile")
    info.type = tarfile.SYMTYPE
    info.linkname = "/etc/passwd"
    archive.addfile(info)
PY
LINK_SHA="$(sha256_file "${MALICIOUS_LINK}")"
expect_failure \
  "archive links are forbidden" \
  "${TEMP_DIR}/archive-link.out" \
  "${TOOL}" verify-archive \
    --archive "${MALICIOUS_LINK}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-archive-sha256 "${LINK_SHA}"

TRUNCATED_ARCHIVE="${TEMP_DIR}/truncated.tgz"
python3 - "${ARCHIVE_ONE}" "${TRUNCATED_ARCHIVE}" <<'PY'
import pathlib
import sys

payload = pathlib.Path(sys.argv[1]).read_bytes()
pathlib.Path(sys.argv[2]).write_bytes(payload[: max(16, len(payload) // 3)])
PY
TRUNCATED_SHA="$(sha256_file "${TRUNCATED_ARCHIVE}")"
expect_failure \
  "malformed or truncated" \
  "${TEMP_DIR}/truncated.out" \
  "${TOOL}" verify-archive \
    --archive "${TRUNCATED_ARCHIVE}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-archive-sha256 "${TRUNCATED_SHA}"
if grep -q 'Traceback' "${TEMP_DIR}/truncated.out"; then
  fail "malformed archive escaped the controlled gate error path"
fi

# Existing output is never overwritten, and a tampered archive fails its external digest.
EXISTING_ARCHIVE="${TEMP_DIR}/existing.tgz"
printf '%s\n' 'sentinel' >"${EXISTING_ARCHIVE}"
expect_failure \
  "must not already exist" \
  "${TEMP_DIR}/existing.out" \
  "${TOOL}" seal \
    --root "${RELEASE_ROOT}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --output "${EXISTING_ARCHIVE}"
[[ "$(cat "${EXISTING_ARCHIVE}")" == "sentinel" ]] || fail "existing archive was overwritten"

SYMLINK_ARCHIVE="${TEMP_DIR}/archive-link-output.tgz"
SYMLINK_ARCHIVE_TARGET="${TEMP_DIR}/archive-link-target.tgz"
ln -s "${SYMLINK_ARCHIVE_TARGET}" "${SYMLINK_ARCHIVE}"
expect_failure \
  "must not already exist" \
  "${TEMP_DIR}/existing-link.out" \
  "${TOOL}" seal \
    --root "${RELEASE_ROOT}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --output "${SYMLINK_ARCHIVE}"
[[ ! -e "${SYMLINK_ARCHIVE_TARGET}" ]] || fail "archive output symlink target was created"

# A destination created after the initial check is not overwritten.
RACED_OUTPUT="${TEMP_DIR}/raced-output.tgz"
python3 - \
  "${TOOL}" \
  "${RELEASE_ROOT}" \
  "${MANIFEST_PATH}" \
  "${MANIFEST_SHA256}" \
  "${RACED_OUTPUT}" <<'PY'
import argparse
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location("api_release_source_manifest", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_verify = module.verify_release_root
calls = 0

def plant_destination_on_final_check(root, manifest):
    global calls
    result = original_verify(root, manifest)
    calls += 1
    if calls == 2:
        pathlib.Path(sys.argv[5]).write_text("sentinel\n", encoding="utf-8")
    return result

module.verify_release_root = plant_destination_on_final_check
args = argparse.Namespace(
    root=sys.argv[2],
    manifest=sys.argv[3],
    expected_manifest_sha256=sys.argv[4],
    output=sys.argv[5],
)
try:
    module.seal(args)
except module.ReleaseGateError as error:
    if "refusing to overwrite" not in str(error):
        raise
else:
    raise SystemExit("seal overwrote a destination created during publication")
if pathlib.Path(sys.argv[5]).read_text(encoding="utf-8") != "sentinel\n":
    raise SystemExit("raced destination contents changed")
PY

TAMPERED_ARCHIVE="${TEMP_DIR}/tampered.tgz"
cp "${ARCHIVE_ONE}" "${TAMPERED_ARCHIVE}"
printf '%s' 'x' >>"${TAMPERED_ARCHIVE}"
expect_failure \
  "archive SHA-256 mismatch" \
  "${TEMP_DIR}/tampered.out" \
  "${TOOL}" verify-archive \
    --archive "${TAMPERED_ARCHIVE}" \
    --manifest "${MANIFEST_PATH}" \
    --expected-manifest-sha256 "${MANIFEST_SHA256}" \
    --expected-archive-sha256 "${ARCHIVE_SHA256}"

# The checked-in Cloud Build pipeline invokes the preflight, so omission fails
# before any release archive can be prepared.
NO_PREFLIGHT_SOURCE="${TEMP_DIR}/source-no-preflight"
NO_PREFLIGHT_RELEASE="${TEMP_DIR}/release-no-preflight"
NO_PREFLIGHT_MANIFEST="${TEMP_DIR}/manifest-no-preflight.json"
cp -R "${SOURCE_ROOT}" "${NO_PREFLIGHT_SOURCE}"
rm "${NO_PREFLIGHT_SOURCE}/scripts/preflight-cloud-run-release.sh"
expect_failure \
  "required release file is missing" \
  "${TEMP_DIR}/missing-preflight.out" \
  "${TOOL}" prepare \
    --source-root "${NO_PREFLIGHT_SOURCE}" \
    --release-root "${NO_PREFLIGHT_RELEASE}" \
    --manifest "${NO_PREFLIGHT_MANIFEST}"

printf 'ReadMate API release source manifest regression test: PASS\n'
