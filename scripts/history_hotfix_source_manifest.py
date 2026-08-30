#!/usr/bin/env python3
"""Prepare and verify the immutable source manifest for the history hotfix."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import stat
import sys
import tarfile
import tempfile
from pathlib import Path
from pathlib import PurePosixPath


MANIFEST_SCHEMA_VERSION = 1
DEFAULT_MANIFEST_NAME = "history-hotfix-release-manifest.json"
MAX_ARCHIVE_MEMBERS = 50_000
MAX_EXTRACTED_BYTES = 1_073_741_824
REPOSITORY_ROOT_MARKERS = (
    "Dockerfile",
    "package-lock.json",
    "apps/api/package.json",
)
APPROVED_CHANGED_FILES = sorted(
    [
        "apps/api/src/routes/documents.test.ts",
        "apps/api/src/routes/documents.ts",
        "scripts/deploy-cloud-run-history-hotfix-candidate.sh",
    ]
)
REQUIRED_CHANGED_FILES = sorted(
    [
        "apps/api/src/routes/documents.test.ts",
        "apps/api/src/routes/documents.ts",
        "scripts/deploy-cloud-run-history-hotfix-candidate.sh",
    ]
)


class ManifestError(RuntimeError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_sha256(value: str, label: str) -> None:
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ManifestError(f"{label} must be a 64-character lowercase sha256.")


def validate_generation(value: str) -> None:
    if not value.isdigit() or int(value) <= 0:
        raise ManifestError("baseline source generation must be a positive integer.")


def validate_source_uri(value: str) -> None:
    if not value.startswith("gs://") or value.endswith("/") or "#" in value:
        raise ManifestError("baseline source URI must be one exact gs:// object without a generation suffix.")


def normalized_archive_member(name: str) -> PurePosixPath | None:
    if "\\" in name or any(ord(character) < 32 or ord(character) == 127 for character in name):
        raise ManifestError(f"archive member name is not permitted: {name!r}")
    path = PurePosixPath(name)
    parts = tuple(part for part in path.parts if part not in ("", "."))
    if not parts:
        return None
    if path.is_absolute() or ".." in parts or ".git" in parts:
        raise ManifestError(f"archive member escapes the extraction root: {name!r}")
    return PurePosixPath(*parts)


def extract_verified_archive(archive_path: Path, destination: Path) -> Path:
    """Extract a verified source archive without links or path traversal."""

    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=False)
    seen: set[str] = set()
    try:
        archive = tarfile.open(archive_path, mode="r:*")
    except (tarfile.TarError, OSError) as error:
        raise ManifestError(f"baseline archive is not a readable tar archive: {error}") from error

    with archive:
        members = archive.getmembers()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise ManifestError(f"archive contains more than {MAX_ARCHIVE_MEMBERS} members")
        total_size = sum(member.size for member in members if member.isfile())
        if total_size > MAX_EXTRACTED_BYTES:
            raise ManifestError(f"archive expands beyond {MAX_EXTRACTED_BYTES} bytes")

        seen_casefolded: set[str] = set()
        for member in members:
            relative = normalized_archive_member(member.name)
            if relative is None:
                continue
            relative_name = relative.as_posix()
            if relative_name in seen:
                raise ManifestError(f"archive contains duplicate member: {relative_name}")
            seen.add(relative_name)
            casefolded = relative_name.casefold()
            if casefolded in seen_casefolded:
                raise ManifestError(f"archive contains a case-folding path collision: {relative_name}")
            seen_casefolded.add(casefolded)

            if member.issym() or member.islnk():
                raise ManifestError(f"archive links are not permitted: {relative_name}")
            if not member.isdir() and not member.isfile():
                raise ManifestError(f"archive member type is not permitted: {relative_name}")
            if member.mode & (stat.S_ISUID | stat.S_ISGID):
                raise ManifestError(f"archive setuid/setgid modes are not permitted: {relative_name}")

            target = destination.joinpath(*relative.parts)
            if os.path.commonpath((destination, target.resolve(strict=False))) != str(destination):
                raise ManifestError(f"archive member escapes the extraction root: {relative_name}")

            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                target.chmod(stat.S_IMODE(member.mode))
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ManifestError(f"archive member has no readable contents: {relative_name}")
            with source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            target.chmod(stat.S_IMODE(member.mode))

    top_level = sorted(destination.iterdir(), key=lambda path: path.name)
    if len(top_level) == 1 and top_level[0].is_dir():
        return top_level[0]
    return destination


def assert_repository_root(root: Path, label: str) -> None:
    missing = [marker for marker in REPOSITORY_ROOT_MARKERS if not (root / marker).is_file()]
    if missing:
        raise ManifestError(f"{label} is not an unambiguous ReadMate repository root; missing {missing}")


def write_deterministic_archive(root: Path, output_path: Path, manifest_name: str) -> None:
    if not root.is_dir():
        raise ManifestError(f"source root does not exist: {root}")
    if output_path == root or root in output_path.parents:
        raise ManifestError("sealed archive output must be outside the release source root.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as raw_output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_output, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for path in sorted(root.rglob("*"), key=lambda candidate: candidate.as_posix()):
                    relative_path = path.relative_to(root).as_posix()
                    if ".git" in Path(relative_path).parts:
                        continue
                    if path.is_symlink():
                        raise ManifestError(f"release source links are not permitted: {relative_path}")
                    if not path.is_dir() and not path.is_file():
                        raise ManifestError(f"release source entry type is not permitted: {relative_path}")

                    info = tarfile.TarInfo(relative_path)
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    info.mtime = 0
                    info.mode = stat.S_IMODE(path.stat().st_mode)
                    if info.mode & (stat.S_ISUID | stat.S_ISGID):
                        raise ManifestError(f"release source setuid/setgid modes are not permitted: {relative_path}")
                    if path.is_dir():
                        info.type = tarfile.DIRTYPE
                        archive.addfile(info)
                    else:
                        info.size = path.stat().st_size
                        with path.open("rb") as source:
                            archive.addfile(info, source)


def ignored_path(relative_path: str, manifest_name: str) -> bool:
    parts = Path(relative_path).parts
    return relative_path == manifest_name or ".git" in parts


def source_entries(root: Path, manifest_name: str) -> dict[str, dict[str, str | int]]:
    if not root.is_dir():
        raise ManifestError(f"source root does not exist: {root}")

    entries: dict[str, dict[str, str | int]] = {}
    for path in sorted(root.rglob("*"), key=lambda candidate: candidate.as_posix()):
        relative_path = path.relative_to(root).as_posix()
        if ignored_path(relative_path, manifest_name):
            continue
        if path.is_symlink():
            entries[relative_path] = {
                "kind": "symlink",
                "mode": stat.S_IMODE(path.lstat().st_mode),
                "sha256": sha256_bytes(os.readlink(path).encode("utf-8")),
            }
        elif path.is_file():
            entries[relative_path] = {
                "kind": "file",
                "mode": stat.S_IMODE(path.stat().st_mode),
                "sha256": sha256_file(path),
            }
    return entries


def source_tree_sha256(root: Path, manifest_name: str) -> str:
    entries = source_entries(root, manifest_name)
    canonical = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256_bytes(canonical)


def changed_files(baseline_root: Path, release_root: Path, manifest_name: str) -> list[str]:
    baseline = source_entries(baseline_root, manifest_name)
    release = source_entries(release_root, manifest_name)
    return sorted(
        path
        for path in set(baseline) | set(release)
        if baseline.get(path) != release.get(path)
    )


def canonical_manifest_bytes(manifest: dict[str, object]) -> bytes:
    return (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")


def load_manifest(path: Path) -> tuple[dict[str, object], bytes]:
    if not path.is_file():
        raise ManifestError(f"release manifest is missing: {path}")
    raw = path.read_bytes()
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ManifestError(f"release manifest is not valid JSON: {error}") from error
    if not isinstance(manifest, dict):
        raise ManifestError("release manifest must be a JSON object.")
    if raw != canonical_manifest_bytes(manifest):
        raise ManifestError("release manifest must use canonical sorted JSON formatting.")
    return manifest, raw


def prepare(args: argparse.Namespace) -> None:
    release_root = Path(args.release_root).resolve()
    archive_path = Path(args.baseline_archive).resolve()
    manifest_path = release_root / args.manifest_name

    validate_source_uri(args.baseline_source_uri)
    validate_generation(args.baseline_source_generation)
    validate_sha256(args.expected_baseline_archive_sha256, "expected baseline archive sha256")
    if not archive_path.is_file():
        raise ManifestError(f"baseline archive does not exist: {archive_path}")

    archive_sha256 = sha256_file(archive_path)
    if archive_sha256 != args.expected_baseline_archive_sha256:
        raise ManifestError(
            f"baseline archive sha256 mismatch: expected {args.expected_baseline_archive_sha256}, got {archive_sha256}"
        )

    with tempfile.TemporaryDirectory(prefix="readmate-history-baseline-") as temporary_directory:
        extraction_root = Path(temporary_directory) / "source"
        baseline_root = extract_verified_archive(archive_path, extraction_root)
        assert_repository_root(baseline_root, "verified baseline archive")
        assert_repository_root(release_root, "release source")
        actual_changes = changed_files(baseline_root, release_root, args.manifest_name)
        unexpected_changes = sorted(set(actual_changes) - set(APPROVED_CHANGED_FILES))
        missing_required_changes = sorted(set(REQUIRED_CHANGED_FILES) - set(actual_changes))
        if unexpected_changes or missing_required_changes:
            raise ManifestError(
                "release source does not match the history-hotfix allowlist: "
                + json.dumps(
                    {
                        "unexpectedChangedFiles": unexpected_changes,
                        "missingRequiredChangedFiles": missing_required_changes,
                    },
                    sort_keys=True,
                )
            )

        manifest: dict[str, object] = {
            "allowedChangedFiles": actual_changes,
            "baselineArchiveSha256": archive_sha256,
            "baselineSourceGeneration": args.baseline_source_generation,
            "baselineSourceUri": args.baseline_source_uri,
            "baselineTreeSha256": source_tree_sha256(baseline_root, args.manifest_name),
            "releaseTreeSha256": source_tree_sha256(release_root, args.manifest_name),
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
        }
    raw = canonical_manifest_bytes(manifest)
    manifest_path.write_bytes(raw)

    print(f"release_manifest={manifest_path}")
    print(f"release_manifest_sha256={sha256_bytes(raw)}")
    print(f"baseline_archive_sha256={archive_sha256}")
    print(f"baseline_tree_sha256={manifest['baselineTreeSha256']}")
    print(f"release_tree_sha256={manifest['releaseTreeSha256']}")
    print("source_isolation=exact_baseline_plus_allowlist_only")


def verify(args: argparse.Namespace) -> None:
    root = Path(args.root).resolve()
    manifest_path = root / args.manifest_name

    validate_source_uri(args.expected_baseline_source_uri)
    validate_generation(args.expected_baseline_source_generation)
    validate_sha256(args.expected_baseline_archive_sha256, "expected baseline archive sha256")
    validate_sha256(args.expected_manifest_sha256, "expected release manifest sha256")

    manifest, raw = load_manifest(manifest_path)
    actual_manifest_sha256 = sha256_bytes(raw)
    if actual_manifest_sha256 != args.expected_manifest_sha256:
        raise ManifestError(
            f"release manifest sha256 mismatch: expected {args.expected_manifest_sha256}, got {actual_manifest_sha256}"
        )

    expected_fields: dict[str, object] = {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "baselineSourceUri": args.expected_baseline_source_uri,
        "baselineSourceGeneration": args.expected_baseline_source_generation,
        "baselineArchiveSha256": args.expected_baseline_archive_sha256,
    }
    for key, expected in expected_fields.items():
        if manifest.get(key) != expected:
            raise ManifestError(f"release manifest field {key} does not match the approved value.")

    allowed_changes = manifest.get("allowedChangedFiles")
    if not isinstance(allowed_changes, list) or not all(isinstance(path, str) for path in allowed_changes):
        raise ManifestError("release manifest field allowedChangedFiles must be a string list.")
    if allowed_changes != sorted(set(allowed_changes)):
        raise ManifestError("release manifest field allowedChangedFiles must be sorted and unique.")
    unexpected_changes = sorted(set(allowed_changes) - set(APPROVED_CHANGED_FILES))
    missing_required_changes = sorted(set(REQUIRED_CHANGED_FILES) - set(allowed_changes))
    if unexpected_changes or missing_required_changes:
        raise ManifestError("release manifest allowedChangedFiles does not match the approved hotfix scope.")

    for key in ("baselineTreeSha256", "releaseTreeSha256"):
        value = manifest.get(key)
        if not isinstance(value, str):
            raise ManifestError(f"release manifest field {key} is missing.")
        validate_sha256(value, key)

    actual_tree_sha256 = source_tree_sha256(root, args.manifest_name)
    if actual_tree_sha256 != manifest["releaseTreeSha256"]:
        raise ManifestError(
            f"submitted source tree sha256 mismatch: expected {manifest['releaseTreeSha256']}, got {actual_tree_sha256}"
        )

    print(f"release_manifest_sha256={actual_manifest_sha256}")
    print(f"release_tree_sha256={actual_tree_sha256}")
    print(f"baseline_source_uri={args.expected_baseline_source_uri}")
    print(f"baseline_source_generation={args.expected_baseline_source_generation}")
    print(f"baseline_archive_sha256={args.expected_baseline_archive_sha256}")
    print("source_isolation=verified")


def seal(args: argparse.Namespace) -> None:
    verify(args)
    root = Path(args.root).resolve()
    output_path = Path(args.output).resolve()
    manifest, expected_manifest = load_manifest(root / args.manifest_name)
    if sha256_bytes(expected_manifest) != args.expected_manifest_sha256:
        raise ManifestError("release manifest changed after verification")
    expected_tree = manifest.get("releaseTreeSha256")
    if not isinstance(expected_tree, str):
        raise ManifestError("release manifest field releaseTreeSha256 is missing")
    validate_sha256(expected_tree, "releaseTreeSha256")
    write_deterministic_archive(root, output_path, args.manifest_name)
    archive_sha256 = sha256_file(output_path)
    with tempfile.TemporaryDirectory(prefix="readmate-history-seal-check-") as temporary_directory:
        extracted_root = extract_verified_archive(output_path, Path(temporary_directory) / "source")
        assert_repository_root(extracted_root, "sealed release archive")
        actual_tree = source_tree_sha256(extracted_root, args.manifest_name)
        if actual_tree != expected_tree:
            raise ManifestError(
                f"sealed release archive tree mismatch: expected {expected_tree}, got {actual_tree}"
            )
        actual_manifest = (extracted_root / args.manifest_name).read_bytes()
        if actual_manifest != expected_manifest:
            raise ManifestError("sealed release archive changed the canonical release manifest")
    print(f"sealed_release_archive={output_path}")
    print(f"sealed_release_archive_sha256={archive_sha256}")
    print("sealed_release_source=ready_for_generation-locked-upload")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--release-root", required=True)
    prepare_parser.add_argument("--baseline-archive", required=True)
    prepare_parser.add_argument("--baseline-source-uri", required=True)
    prepare_parser.add_argument("--baseline-source-generation", required=True)
    prepare_parser.add_argument("--expected-baseline-archive-sha256", required=True)
    prepare_parser.add_argument("--manifest-name", default=DEFAULT_MANIFEST_NAME)
    prepare_parser.set_defaults(func=prepare)

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--root", required=True)
    verify_parser.add_argument("--expected-manifest-sha256", required=True)
    verify_parser.add_argument("--expected-baseline-source-uri", required=True)
    verify_parser.add_argument("--expected-baseline-source-generation", required=True)
    verify_parser.add_argument("--expected-baseline-archive-sha256", required=True)
    verify_parser.add_argument("--manifest-name", default=DEFAULT_MANIFEST_NAME)
    verify_parser.set_defaults(func=verify)

    seal_parser = subparsers.add_parser("seal")
    seal_parser.add_argument("--root", required=True)
    seal_parser.add_argument("--output", required=True)
    seal_parser.add_argument("--expected-manifest-sha256", required=True)
    seal_parser.add_argument("--expected-baseline-source-uri", required=True)
    seal_parser.add_argument("--expected-baseline-source-generation", required=True)
    seal_parser.add_argument("--expected-baseline-archive-sha256", required=True)
    seal_parser.add_argument("--manifest-name", default=DEFAULT_MANIFEST_NAME)
    seal_parser.set_defaults(func=seal)
    return parser


def main() -> int:
    try:
        args = build_parser().parse_args()
        args.func(args)
        return 0
    except ManifestError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
