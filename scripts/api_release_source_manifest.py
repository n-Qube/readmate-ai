#!/usr/bin/env python3
"""Build and verify a minimal, deterministic ReadMate API release archive.

The release manifest is intentionally stored outside the source tree.  The
archive therefore contains only the files required by the Cloud Run API build;
the separately hashed manifest is the trust record for that exact file set.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import secrets
import stat
import struct
import sys
import tarfile
import unicodedata
import zlib
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Iterable


MANIFEST_KIND = "readmate-api-release-source"
MANIFEST_SCHEMA_VERSION = 1
TREE_HASH_ALGORITHM = "sha256-file-tree-v1"
MAX_FILE_BYTES = 134_217_728
MAX_ARCHIVE_BYTES = 536_870_912
MAX_ARCHIVE_MEMBERS = 20_000

REQUIRED_ROOT_FILES = (
    ".dockerignore",
    "Dockerfile",
    "cloudbuild.yaml",
    "package-lock.json",
    "package.json",
    "scripts/deploy-cloud-run-candidate.sh",
    "scripts/patch-expo-modules-jsi-xcode27.cjs",
    "scripts/preflight-cloud-run-release.sh",
    "tsconfig.base.json",
    # The API regression suite imports this exact checked-in feed to prove the
    # public WebMCP fixture stays ingestible in the same release being built.
    "apps/mobile/public/challenge-feed.xml",
)
REQUIRED_API_FILES = (
    "apps/api/package.json",
    "apps/api/prisma/schema.prisma",
    "apps/api/src/server.ts",
    "apps/api/tsconfig.json",
    "apps/api/vitest.config.ts",
)

EXCLUDED_DIRECTORY_NAMES = frozenset(
    {
        ".cache",
        ".next",
        ".pytest_cache",
        ".turbo",
        ".vitest",
        "__pycache__",
        "coverage",
        "dist",
        "node_modules",
    }
)
EXCLUDED_FILE_SUFFIXES = (".cache", ".log", ".pyc", ".pyo", ".swp", ".tmp")
SENSITIVE_FILE_SUFFIXES = (
    ".jks",
    ".key",
    ".keystore",
    ".mobileprovision",
    ".p12",
    ".pem",
    ".pfx",
)
SENSITIVE_FILE_NAMES = frozenset(
    {
        ".npmrc",
        ".secrets",
        "application_default_credentials.json",
        "credentials.json",
        "debug.keystore",
        "service-account.json",
        "service_account.json",
        "serviceaccount.json",
    }
)
KNOWN_NON_CLOUD_RUN_API_PREFIXES = ("apps/api/api/",)
KNOWN_NON_CLOUD_RUN_API_FILES = frozenset({"apps/api/vercel.json"})
ALLOWED_SOURCE_SUFFIXES = frozenset({".cjs", ".cts", ".js", ".json", ".mjs", ".mts", ".ts", ".tsx"})
SECRET_PATTERNS = (
    (
        "private key material",
        re.compile(rb"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    ),
    ("Google API key", re.compile(rb"AIza[0-9A-Za-z_-]{35}")),
    ("AWS access key", re.compile(rb"(?:AKIA|ASIA)[0-9A-Z]{16}")),
    ("GitHub token", re.compile(rb"gh[pousr]_[A-Za-z0-9_]{20,}")),
    ("Slack token", re.compile(rb"xox[baprs]-[0-9A-Za-z-]{20,}")),
    ("live or test secret key", re.compile(rb"sk_(?:live|test)_[0-9A-Za-z]{16,}")),
    (
        "database URL with embedded credentials",
        re.compile(rb"postgres(?:ql)?://[^\s:/@]+:[^\s/@]+@", re.IGNORECASE),
    ),
)


class ReleaseGateError(RuntimeError):
    """Raised when the release-source gate cannot prove an invariant."""


def fail(message: str) -> None:
    raise ReleaseGateError(message)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def validate_sha256(value: str, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        fail(f"{label} must be exactly 64 lowercase hexadecimal characters")
    return value


def normalized_relative_path(value: str, label: str = "path") -> str:
    if not isinstance(value, str) or not value:
        fail(f"{label} must be a non-empty relative POSIX path")
    if "\\" in value or "\x00" in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        fail(f"{label} contains unsafe characters")
    path = PurePosixPath(value)
    parts = path.parts
    if path.is_absolute() or not parts or any(part in ("", ".", "..") for part in parts):
        fail(f"{label} contains an unsafe archive path")
    if ".git" in parts:
        fail(f"{label} addresses forbidden Git metadata")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        fail(f"{label} is not valid UTF-8: {error}")
    return path.as_posix()


def sensitive_path_reason(relative: str) -> str | None:
    for part in PurePosixPath(relative).parts:
        name = part.lower()
        if name == ".env" or name.startswith(".env."):
            return "environment path"
        if name.startswith("._"):
            return "AppleDouble metadata path"
        if name in SENSITIVE_FILE_NAMES:
            return "credential path"
        if any(name.endswith(suffix) for suffix in SENSITIVE_FILE_SUFFIXES):
            return "credential or signing-key path"
    return None


def excluded_source_path(relative: str, *, is_directory: bool) -> bool:
    parts = PurePosixPath(relative).parts
    if any(part in EXCLUDED_DIRECTORY_NAMES for part in parts):
        return True
    if is_directory:
        return False
    name = parts[-1]
    return (
        name == ".DS_Store"
        or name == ".env"
        or name.startswith(".env.")
        or name.endswith(EXCLUDED_FILE_SUFFIXES)
    )


def is_allowed_release_path(relative: str) -> bool:
    if relative in REQUIRED_ROOT_FILES:
        return True
    if relative in {
        "apps/api/package.json",
        "apps/api/tsconfig.json",
        "apps/api/vitest.config.ts",
        "apps/api/prisma/schema.prisma",
        "apps/api/prisma/migration_lock.toml",
    }:
        return True
    if relative.startswith("apps/api/src/"):
        return PurePosixPath(relative).suffix in ALLOWED_SOURCE_SUFFIXES
    if relative.startswith("apps/api/prisma/migrations/"):
        parts = PurePosixPath(relative).parts
        return len(parts) == 6 and parts[-1] == "migration.sql"
    return False


def require_real_directory(raw: str | Path, label: str) -> Path:
    path = Path(raw)
    try:
        metadata = path.lstat()
    except OSError as error:
        fail(f"{label} cannot be inspected: {error}")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        fail(f"{label} must be a real directory, not a link or special file")
    return path.resolve(strict=True)


def require_real_regular_file(raw: str | Path, label: str) -> Path:
    path = Path(raw)
    try:
        metadata = path.lstat()
    except OSError as error:
        fail(f"{label} cannot be inspected: {error}")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        fail(f"{label} must be a real regular file, not a link or special file")
    return path.resolve(strict=True)


def assert_no_link_components(root: Path, relative: str) -> Path:
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        try:
            metadata = current.lstat()
        except OSError as error:
            fail(f"source path {relative} cannot be inspected: {error}")
        if stat.S_ISLNK(metadata.st_mode):
            fail(f"source contains a forbidden symbolic link: {relative}")
    return current


def safe_mode(metadata: os.stat_result, relative: str) -> int:
    if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
        fail(f"source file has a forbidden privileged mode: {relative}")
    return 0o755 if metadata.st_mode & 0o111 else 0o644


def directory_open_flags() -> int:
    nofollow = getattr(os, "O_NOFOLLOW", None)
    directory = getattr(os, "O_DIRECTORY", None)
    if nofollow is None or directory is None:
        fail("this platform cannot guarantee no-follow directory traversal")
    return os.O_RDONLY | nofollow | directory


def open_anchored_directory(root: Path, relative: str | None, label: str) -> int:
    """Open a directory through no-follow descriptors for every path component."""

    flags = directory_open_flags()
    try:
        descriptor = os.open(root, flags)
    except OSError as error:
        fail(f"{label} root cannot be opened safely: {error}")
    try:
        if relative:
            normalized_relative_path(relative, label)
            for part in PurePosixPath(relative).parts:
                try:
                    child = os.open(part, flags, dir_fd=descriptor)
                except OSError as error:
                    fail(f"{label} cannot be opened safely: {error}")
                os.close(descriptor)
                descriptor = child
        metadata = os.fstat(descriptor)
        if not stat.S_ISDIR(metadata.st_mode):
            fail(f"{label} is not a real directory")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def open_anchored_regular_file(root: Path, relative: str, label: str) -> int:
    normalized_relative_path(relative, label)
    parts = PurePosixPath(relative).parts
    parent = PurePosixPath(*parts[:-1]).as_posix() if len(parts) > 1 else None
    directory_descriptor = open_anchored_directory(root, parent, label)
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        os.close(directory_descriptor)
        fail("this platform cannot guarantee no-follow file reads")
    try:
        descriptor = os.open(parts[-1], os.O_RDONLY | nofollow, dir_fd=directory_descriptor)
    except OSError as error:
        fail(f"{label} cannot be opened safely: {error}")
    finally:
        os.close(directory_descriptor)
    return descriptor


def read_stable_descriptor(
    descriptor: int,
    relative: str,
    *,
    max_bytes: int,
) -> tuple[int, bytes, str]:
    before = os.fstat(descriptor)
    if not stat.S_ISREG(before.st_mode):
        fail(f"source entry is not a regular file: {relative}")
    if before.st_size > max_bytes:
        fail(f"file exceeds the {max_bytes}-byte limit: {relative}")
    chunks: list[bytes] = []
    total = 0
    digest = hashlib.sha256()
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            fail(f"file grew beyond the {max_bytes}-byte limit while reading: {relative}")
        chunks.append(chunk)
        digest.update(chunk)
    after = os.fstat(descriptor)
    stable_fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns")
    if any(getattr(before, field) != getattr(after, field) for field in stable_fields) or total != before.st_size:
        fail(f"source file changed while it was being read: {relative}")
    return safe_mode(before, relative), b"".join(chunks), digest.hexdigest()


def read_stable_binary(
    path: Path,
    relative: str,
    *,
    max_bytes: int,
) -> tuple[int, bytes, str]:
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        fail("this platform cannot guarantee no-follow source reads")
    try:
        descriptor = os.open(path, os.O_RDONLY | nofollow)
    except OSError as error:
        fail(f"source file {relative} cannot be opened safely: {error}")
    try:
        return read_stable_descriptor(descriptor, relative, max_bytes=max_bytes)
    finally:
        os.close(descriptor)


def read_stable_file(path: Path, relative: str) -> tuple[int, bytes, str]:
    mode, payload, digest = read_stable_binary(
        path,
        relative,
        max_bytes=MAX_FILE_BYTES,
    )
    for description, pattern in SECRET_PATTERNS:
        if pattern.search(payload):
            fail(f"sensitive content ({description}) is not permitted in release source: {relative}")
    return mode, payload, digest


def scan_sensitive_payload(payload: bytes, relative: str) -> None:
    for description, pattern in SECRET_PATTERNS:
        if pattern.search(payload):
            fail(f"sensitive content ({description}) is not permitted in release source: {relative}")


def read_anchored_release_file(root: Path, relative: str) -> tuple[int, bytes, str]:
    descriptor = open_anchored_regular_file(root, relative, f"source file {relative}")
    try:
        mode, payload, digest = read_stable_descriptor(
            descriptor,
            relative,
            max_bytes=MAX_FILE_BYTES,
        )
    finally:
        os.close(descriptor)
    scan_sensitive_payload(payload, relative)
    return mode, payload, digest


def source_api_files(source_root: Path) -> list[str]:
    selected: list[str] = []

    def walk(directory_descriptor: int, prefix: str) -> None:
        try:
            names = sorted(os.listdir(directory_descriptor), key=os.fsencode)
        except OSError as error:
            fail(f"API source directory cannot be read safely: {error}")
        for name in names:
            relative = f"{prefix}/{name}"
            normalized_relative_path(relative, "API source path")
            try:
                metadata = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
            except OSError as error:
                fail(f"API source path cannot be inspected: {relative}: {error}")
            if stat.S_ISLNK(metadata.st_mode):
                fail(f"source contains a forbidden symbolic link: {relative}")
            if stat.S_ISDIR(metadata.st_mode):
                reason = sensitive_path_reason(relative)
                if reason:
                    fail(f"source contains a sensitive {reason}: {relative}")
                if excluded_source_path(relative, is_directory=True):
                    # Links have already been rejected; generated directories are
                    # deliberately omitted from the minimal release.
                    continue
                try:
                    child_descriptor = os.open(
                        name,
                        directory_open_flags(),
                        dir_fd=directory_descriptor,
                    )
                except OSError as error:
                    fail(f"API source directory cannot be opened safely: {relative}: {error}")
                try:
                    walk(child_descriptor, relative)
                finally:
                    os.close(child_descriptor)
                continue
            if not stat.S_ISREG(metadata.st_mode):
                fail(f"source contains a forbidden special file: {relative}")
            if excluded_source_path(relative, is_directory=False):
                continue
            if relative in KNOWN_NON_CLOUD_RUN_API_FILES or relative.startswith(
                KNOWN_NON_CLOUD_RUN_API_PREFIXES
            ):
                continue
            if not is_allowed_release_path(relative):
                fail(f"unclassified or unrelated API file is not permitted in release source: {relative}")
            selected.append(relative)

    api_descriptor = open_anchored_directory(source_root, "apps/api", "apps/api")
    try:
        walk(api_descriptor, "apps/api")
    finally:
        os.close(api_descriptor)
    return selected


def selected_source_paths(source_root: Path) -> list[str]:
    selected: list[str] = []
    for relative in REQUIRED_ROOT_FILES:
        candidate = source_root / relative
        if not candidate.exists() and not candidate.is_symlink():
            fail(f"required release file is missing or not regular: {relative}")
        path = assert_no_link_components(source_root, relative)
        if not path.is_file():
            fail(f"required release file is missing or not regular: {relative}")
        selected.append(relative)
    selected.extend(source_api_files(source_root))
    selected = sorted(set(selected), key=os.fsencode)
    missing_api = sorted(set(REQUIRED_API_FILES) - set(selected), key=os.fsencode)
    if missing_api:
        fail(f"required API release files are missing: {json.dumps(missing_api)}")
    if not any(path.startswith("apps/api/prisma/migrations/") for path in selected):
        fail("at least one Prisma migration is required in the API release source")
    return selected


def canonical_file_record(relative: str, mode: int, payload: bytes, digest: str) -> dict[str, Any]:
    return {"mode": mode, "path": relative, "sha256": digest, "size": len(payload)}


def tree_sha256(records: Iterable[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    digest.update((TREE_HASH_ALGORITHM + "\0").encode("ascii"))
    for record in sorted(records, key=lambda item: os.fsencode(item["path"])):
        path = record["path"].encode("utf-8")
        digest.update(b"F\0")
        digest.update(struct.pack(">I", len(path)))
        digest.update(path)
        digest.update(struct.pack(">I", record["mode"]))
        digest.update(struct.pack(">Q", record["size"]))
        digest.update(bytes.fromhex(record["sha256"]))
    return digest.hexdigest()


def canonical_manifest_bytes(manifest: dict[str, Any]) -> bytes:
    return (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def build_manifest(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "kind": MANIFEST_KIND,
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "source": {
            "fileCount": len(records),
            "files": records,
            "treeHashAlgorithm": TREE_HASH_ALGORITHM,
            "treeSha256": tree_sha256(records),
        },
    }


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"manifest contains duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_manifest(path: Path, expected_sha256: str) -> tuple[dict[str, Any], bytes]:
    expected_sha256 = validate_sha256(expected_sha256, "expected manifest SHA-256")
    manifest_path = require_real_regular_file(path, "release manifest")
    raw = read_stable_file(manifest_path, manifest_path.name)[1]
    actual_sha256 = sha256_bytes(raw)
    if actual_sha256 != expected_sha256:
        fail(
            f"release manifest SHA-256 mismatch: expected {expected_sha256}, got {actual_sha256}"
        )
    try:
        manifest = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"release manifest is not strict UTF-8 JSON: {error}")
    if not isinstance(manifest, dict) or set(manifest) != {"kind", "schemaVersion", "source"}:
        fail("release manifest root schema has missing or unexpected fields")
    if (
        manifest["kind"] != MANIFEST_KIND
        or type(manifest["schemaVersion"]) is not int
        or manifest["schemaVersion"] != MANIFEST_SCHEMA_VERSION
    ):
        fail("release manifest kind or schema version is unsupported")
    source = manifest["source"]
    if not isinstance(source, dict) or set(source) != {
        "fileCount",
        "files",
        "treeHashAlgorithm",
        "treeSha256",
    }:
        fail("release manifest source schema has missing or unexpected fields")
    if source["treeHashAlgorithm"] != TREE_HASH_ALGORITHM:
        fail("release manifest tree hash algorithm is unsupported")
    validate_sha256(source["treeSha256"], "manifest tree SHA-256")
    files = source["files"]
    if not isinstance(files, list) or not files:
        fail("release manifest files must be a non-empty array")
    if len(files) > MAX_ARCHIVE_MEMBERS:
        fail(f"release manifest contains more than {MAX_ARCHIVE_MEMBERS} files")
    if type(source["fileCount"]) is not int or source["fileCount"] != len(files):
        fail("release manifest fileCount does not match files")
    seen: set[str] = set()
    seen_normalized: set[str] = set()
    ordered_paths: list[str] = []
    previous: bytes | None = None
    total_size = 0
    for record in files:
        if not isinstance(record, dict) or set(record) != {"mode", "path", "sha256", "size"}:
            fail("release manifest file record has missing or unexpected fields")
        relative = normalized_relative_path(record["path"], "manifest file path")
        if sensitive_path_reason(relative):
            fail(f"release manifest contains a sensitive file path: {relative}")
        if not is_allowed_release_path(relative):
            fail(f"release manifest contains an unrelated file path: {relative}")
        encoded = os.fsencode(relative)
        if relative in seen or (previous is not None and encoded <= previous):
            fail("release manifest file paths must be bytewise sorted and unique")
        normalized_key = unicodedata.normalize("NFC", relative).casefold()
        if normalized_key in seen_normalized:
            fail(f"release manifest contains a Unicode or case-folding path collision: {relative}")
        seen.add(relative)
        seen_normalized.add(normalized_key)
        ordered_paths.append(relative)
        previous = encoded
        if type(record["mode"]) is not int or record["mode"] not in (0o644, 0o755):
            fail(f"release manifest file mode is invalid: {relative}")
        if type(record["size"]) is not int or record["size"] < 0 or record["size"] > MAX_FILE_BYTES:
            fail(f"release manifest file size is invalid: {relative}")
        total_size += record["size"]
        if total_size > MAX_ARCHIVE_BYTES:
            fail(f"release manifest expands beyond {MAX_ARCHIVE_BYTES} bytes")
        validate_sha256(record["sha256"], f"manifest file SHA-256 for {relative}")
    for previous_path, current_path in zip(ordered_paths, ordered_paths[1:]):
        if current_path.startswith(previous_path + "/"):
            fail(f"release manifest contains a file/directory prefix collision: {previous_path}")
    missing_root = sorted(set(REQUIRED_ROOT_FILES) - seen, key=os.fsencode)
    missing_api = sorted(set(REQUIRED_API_FILES) - seen, key=os.fsencode)
    if missing_root or missing_api:
        fail(
            "release manifest omits required files: "
            + json.dumps(sorted(missing_root + missing_api, key=os.fsencode))
        )
    if not any(path.startswith("apps/api/prisma/migrations/") for path in seen):
        fail("release manifest omits Prisma migrations")
    if tree_sha256(files) != source["treeSha256"]:
        fail("release manifest tree SHA-256 does not match its file records")
    if raw != canonical_manifest_bytes(manifest):
        fail("release manifest must use canonical sorted JSON formatting")
    return manifest, raw


def expected_directories(file_paths: Iterable[str]) -> set[str]:
    directories: set[str] = set()
    for relative in file_paths:
        parent = PurePosixPath(relative).parent
        while parent.as_posix() != ".":
            directories.add(parent.as_posix())
            parent = parent.parent
    return directories


def snapshot_release_root(root: Path) -> tuple[list[dict[str, Any]], set[str]]:
    records: list[dict[str, Any]] = []
    directories: set[str] = set()
    seen_normalized: set[str] = set()

    def walk(directory_descriptor: int, prefix: str) -> None:
        try:
            names = sorted(os.listdir(directory_descriptor), key=os.fsencode)
        except OSError as error:
            fail(f"release directory cannot be read safely: {error}")
        for name in names:
            relative = f"{prefix}/{name}" if prefix else name
            normalized_relative_path(relative, "release path")
            normalized_key = unicodedata.normalize("NFC", relative).casefold()
            if normalized_key in seen_normalized:
                fail(f"release source contains a Unicode or case-folding path collision: {relative}")
            seen_normalized.add(normalized_key)
            try:
                metadata = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
            except OSError as error:
                fail(f"release path cannot be inspected: {relative}: {error}")
            if stat.S_ISLNK(metadata.st_mode):
                fail(f"release source contains a forbidden symbolic link: {relative}")
            if stat.S_ISDIR(metadata.st_mode):
                directories.add(relative)
                reason = sensitive_path_reason(relative)
                if reason:
                    fail(f"release source contains a sensitive {reason}: {relative}")
                try:
                    child_descriptor = os.open(
                        name,
                        directory_open_flags(),
                        dir_fd=directory_descriptor,
                    )
                except OSError as error:
                    fail(f"release directory cannot be opened safely: {relative}: {error}")
                try:
                    walk(child_descriptor, relative)
                finally:
                    os.close(child_descriptor)
                continue
            if not stat.S_ISREG(metadata.st_mode):
                fail(f"release source contains a forbidden special file: {relative}")
            reason = sensitive_path_reason(relative)
            if reason:
                fail(f"release source contains a sensitive {reason}: {relative}")
            if not is_allowed_release_path(relative):
                fail(f"release source contains an unrelated file: {relative}")
            try:
                descriptor = os.open(
                    name,
                    os.O_RDONLY | getattr(os, "O_NOFOLLOW"),
                    dir_fd=directory_descriptor,
                )
            except OSError as error:
                fail(f"release file cannot be opened safely: {relative}: {error}")
            try:
                mode, payload, digest = read_stable_descriptor(
                    descriptor,
                    relative,
                    max_bytes=MAX_FILE_BYTES,
                )
            finally:
                os.close(descriptor)
            scan_sensitive_payload(payload, relative)
            records.append(canonical_file_record(relative, mode, payload, digest))

    root_descriptor = open_anchored_directory(root, None, "release root")
    try:
        walk(root_descriptor, "")
    finally:
        os.close(root_descriptor)
    records.sort(key=lambda record: os.fsencode(record["path"]))
    return records, directories


def compare_records(actual: list[dict[str, Any]], expected: list[dict[str, Any]], label: str) -> None:
    if actual != expected:
        actual_map = {record["path"]: record for record in actual}
        expected_map = {record["path"]: record for record in expected}
        extra = sorted(set(actual_map) - set(expected_map), key=os.fsencode)
        missing = sorted(set(expected_map) - set(actual_map), key=os.fsencode)
        changed = sorted(
            (path for path in set(actual_map) & set(expected_map) if actual_map[path] != expected_map[path]),
            key=os.fsencode,
        )
        fail(
            f"{label} does not match the approved manifest: "
            + json.dumps({"changed": changed, "extra": extra, "missing": missing}, sort_keys=True)
        )


def verify_release_root(root: Path, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    files = manifest["source"]["files"]
    actual, directories = snapshot_release_root(root)
    compare_records(actual, files, "release source tree")
    expected_dirs = expected_directories(record["path"] for record in files)
    if directories != expected_dirs:
        fail(
            "release source directories do not match the approved manifest: "
            + json.dumps(
                {
                    "extra": sorted(directories - expected_dirs, key=os.fsencode),
                    "missing": sorted(expected_dirs - directories, key=os.fsencode),
                },
                sort_keys=True,
            )
        )
    return actual


def write_exclusive(path: Path, payload: bytes, mode: int) -> None:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    except OSError as error:
        fail(f"refusing to overwrite or create output file {path}: {error}")
    try:
        os.fchmod(descriptor, mode)
        total = 0
        while total < len(payload):
            written = os.write(descriptor, payload[total:])
            if written <= 0:
                fail(f"write did not complete for {path}")
            total += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def copy_selected_source(source_root: Path, release_root: Path) -> list[dict[str, Any]]:
    paths = selected_source_paths(source_root)
    records: list[dict[str, Any]] = []
    total_bytes = 0
    for relative in paths:
        reason = sensitive_path_reason(relative)
        if reason:
            fail(f"selected source path is a sensitive {reason}: {relative}")
        mode, payload, digest = read_anchored_release_file(source_root, relative)
        total_bytes += len(payload)
        if total_bytes > MAX_ARCHIVE_BYTES:
            fail(f"selected release source exceeds the {MAX_ARCHIVE_BYTES}-byte limit")
        target = release_root.joinpath(*PurePosixPath(relative).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        write_exclusive(target, payload, mode)
        records.append(canonical_file_record(relative, mode, payload, digest))
    records.sort(key=lambda record: os.fsencode(record["path"]))
    return records


def prepare(args: argparse.Namespace) -> None:
    source_root = require_real_directory(args.source_root, "source root")
    release_root_raw = Path(args.release_root)
    manifest_raw = Path(args.manifest)
    if release_root_raw.exists() or release_root_raw.is_symlink():
        fail("release root must not already exist")
    if manifest_raw.exists() or manifest_raw.is_symlink():
        fail("release manifest must not already exist")
    release_root = release_root_raw.resolve(strict=False)
    manifest_path = manifest_raw.resolve(strict=False)
    if release_root == source_root or release_root in source_root.parents or source_root in release_root.parents:
        fail("source root and release root must be distinct and non-nested")
    if (
        manifest_path == release_root
        or release_root in manifest_path.parents
        or manifest_path == source_root
        or source_root in manifest_path.parents
    ):
        fail("release manifest must be stored outside the source and release trees")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    release_root.mkdir(parents=True, mode=0o700, exist_ok=False)
    records = copy_selected_source(source_root, release_root)
    manifest = build_manifest(records)
    manifest_payload = canonical_manifest_bytes(manifest)
    write_exclusive(manifest_path, manifest_payload, 0o600)
    manifest_sha256 = sha256_bytes(manifest_payload)
    parsed, _ = parse_manifest(manifest_path, manifest_sha256)
    verify_release_root(release_root, parsed)
    print(f"release_root={release_root}")
    print(f"release_manifest={manifest_path}")
    print(f"release_manifest_sha256={manifest_sha256}")
    print(f"release_source_tree_sha256={manifest['source']['treeSha256']}")
    print(f"release_source_file_count={manifest['source']['fileCount']}")
    print("release_source_gate=prepared")


def verify(args: argparse.Namespace) -> None:
    root = require_real_directory(args.root, "release root")
    manifest, raw = parse_manifest(Path(args.manifest), args.expected_manifest_sha256)
    verify_release_root(root, manifest)
    print(f"release_manifest_sha256={sha256_bytes(raw)}")
    print(f"release_source_tree_sha256={manifest['source']['treeSha256']}")
    print(f"release_source_file_count={manifest['source']['fileCount']}")
    print("release_source_gate=verified")


def archive_member_path(name: str) -> str:
    return normalized_relative_path(name, "archive member path")


def _archive_records_unchecked(archive_payload: bytes) -> list[dict[str, Any]]:
    try:
        archive = tarfile.open(fileobj=io.BytesIO(archive_payload), mode="r:*")
    except (OSError, tarfile.TarError) as error:
        fail(f"release archive is not a readable tar archive: {error}")
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    seen_normalized: set[str] = set()
    total_bytes = 0
    with archive:
        members = archive.getmembers()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            fail(f"release archive contains more than {MAX_ARCHIVE_MEMBERS} members")
        for member in members:
            relative = archive_member_path(member.name)
            normalized_key = unicodedata.normalize("NFC", relative).casefold()
            if relative in seen:
                fail(f"release archive contains a duplicate member: {relative}")
            if normalized_key in seen_normalized:
                fail(f"release archive contains a Unicode or case-folding path collision: {relative}")
            seen.add(relative)
            seen_normalized.add(normalized_key)
            if member.issym() or member.islnk():
                fail(f"release archive links are forbidden: {relative}")
            if not member.isfile():
                fail(f"release archive member is not a regular file: {relative}")
            if member.mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
                fail(f"release archive member has a forbidden privileged mode: {relative}")
            mode = 0o755 if member.mode & 0o111 else 0o644
            if member.size < 0 or member.size > MAX_FILE_BYTES:
                fail(f"release archive member size is invalid: {relative}")
            total_bytes += member.size
            if total_bytes > MAX_ARCHIVE_BYTES:
                fail(f"release archive expands beyond {MAX_ARCHIVE_BYTES} bytes")
            source = archive.extractfile(member)
            if source is None:
                fail(f"release archive member has no readable contents: {relative}")
            digest = hashlib.sha256()
            read_bytes = 0
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                read_bytes += len(chunk)
            if read_bytes != member.size:
                fail(f"release archive member size changed while reading: {relative}")
            records.append(
                {"mode": mode, "path": relative, "sha256": digest.hexdigest(), "size": read_bytes}
            )
    records.sort(key=lambda record: os.fsencode(record["path"]))
    return records


def archive_records(archive_payload: bytes) -> list[dict[str, Any]]:
    try:
        return _archive_records_unchecked(archive_payload)
    except ReleaseGateError:
        raise
    except (EOFError, OSError, tarfile.TarError, zlib.error) as error:
        fail(f"release archive is malformed or truncated: {error}")


def verify_archive_contents(
    archive_path: Path,
    manifest: dict[str, Any],
    expected_archive_sha256: str | None,
) -> str:
    archive_path = require_real_regular_file(archive_path, "release archive")
    _, archive_payload, actual_archive_sha256 = read_stable_binary(
        archive_path,
        "release archive",
        max_bytes=MAX_ARCHIVE_BYTES,
    )
    if expected_archive_sha256 is not None:
        expected = validate_sha256(expected_archive_sha256, "expected release archive SHA-256")
        if actual_archive_sha256 != expected:
            fail(
                f"release archive SHA-256 mismatch: expected {expected}, got {actual_archive_sha256}"
            )
    actual = archive_records(archive_payload)
    compare_records(actual, manifest["source"]["files"], "release archive")
    return actual_archive_sha256


def write_deterministic_archive(
    root: Path,
    output: BinaryIO,
    records: list[dict[str, Any]],
) -> None:
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for record in records:
                relative = record["path"]
                mode, payload, digest = read_anchored_release_file(root, relative)
                if mode != record["mode"] or len(payload) != record["size"] or digest != record["sha256"]:
                    fail(f"release source changed after manifest preparation: {relative}")
                info = tarfile.TarInfo(relative)
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                info.mtime = 0
                info.mode = mode
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))


def seal(args: argparse.Namespace) -> None:
    root = require_real_directory(args.root, "release root")
    manifest, raw = parse_manifest(Path(args.manifest), args.expected_manifest_sha256)
    verify_release_root(root, manifest)
    output_raw = Path(args.output)
    if output_raw.exists() or output_raw.is_symlink():
        fail("sealed release archive output must not already exist")
    if output_raw.name in ("", ".", ".."):
        fail("sealed release archive output must name one file")
    output_parent = require_real_directory(output_raw.parent or Path("."), "archive output directory")
    output = output_parent / output_raw.name
    if output == root or root in output.parents:
        fail("sealed release archive must be stored outside the release source tree")
    parent_descriptor = open_anchored_directory(output_parent, None, "archive output directory")
    temporary_name = f".readmate-api-release-{secrets.token_hex(16)}.tgz"
    temporary_exists = False
    output_linked = False
    succeeded = False
    try:
        nofollow = getattr(os, "O_NOFOLLOW", None)
        if nofollow is None:
            fail("this platform cannot guarantee no-follow archive creation")
        try:
            temporary_descriptor = os.open(
                temporary_name,
                os.O_RDWR | os.O_CREAT | os.O_EXCL | nofollow,
                0o600,
                dir_fd=parent_descriptor,
            )
        except OSError as error:
            fail(f"temporary release archive could not be created safely: {error}")
        temporary_exists = True
        with os.fdopen(temporary_descriptor, "w+b") as temporary:
            write_deterministic_archive(root, temporary, manifest["source"]["files"])
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary.seek(0)
            archive_payload = temporary.read(MAX_ARCHIVE_BYTES + 1)
            if len(archive_payload) > MAX_ARCHIVE_BYTES:
                fail(f"sealed release archive exceeds {MAX_ARCHIVE_BYTES} bytes")
        archive_sha256 = sha256_bytes(archive_payload)
        compare_records(
            archive_records(archive_payload),
            manifest["source"]["files"],
            "release archive",
        )
        # Re-check the staging tree after archiving.  The archive is accepted
        # only if both sides still match the separately approved manifest.
        verify_release_root(root, manifest)
        try:
            os.link(
                temporary_name,
                output.name,
                src_dir_fd=parent_descriptor,
                dst_dir_fd=parent_descriptor,
                follow_symlinks=False,
            )
        except FileExistsError:
            fail("sealed release archive output appeared during sealing; refusing to overwrite it")
        except OSError as error:
            fail(f"sealed release archive could not be published without overwrite: {error}")
        output_linked = True
        os.unlink(temporary_name, dir_fd=parent_descriptor)
        temporary_exists = False
        try:
            os.fsync(parent_descriptor)
        except OSError as error:
            fail(f"sealed release archive directory could not be synchronized: {error}")
        succeeded = True
    finally:
        if temporary_exists:
            try:
                os.unlink(temporary_name, dir_fd=parent_descriptor)
            except FileNotFoundError:
                pass
        if output_linked and not succeeded:
            try:
                os.unlink(output.name, dir_fd=parent_descriptor)
            except FileNotFoundError:
                pass
        os.close(parent_descriptor)
    print(f"sealed_release_archive={output}")
    print(f"sealed_release_archive_sha256={archive_sha256}")
    print(f"release_manifest_sha256={sha256_bytes(raw)}")
    print(f"release_source_tree_sha256={manifest['source']['treeSha256']}")
    print(f"release_source_file_count={manifest['source']['fileCount']}")
    print("sealed_release_source=ready_for_upload")


def verify_archive(args: argparse.Namespace) -> None:
    manifest, raw = parse_manifest(Path(args.manifest), args.expected_manifest_sha256)
    archive_sha256 = verify_archive_contents(
        Path(args.archive), manifest, args.expected_archive_sha256
    )
    print(f"sealed_release_archive_sha256={archive_sha256}")
    print(f"release_manifest_sha256={sha256_bytes(raw)}")
    print(f"release_source_tree_sha256={manifest['source']['treeSha256']}")
    print(f"release_source_file_count={manifest['source']['fileCount']}")
    print("sealed_release_source=verified")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subparsers = result.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--source-root", required=True)
    prepare_parser.add_argument("--release-root", required=True)
    prepare_parser.add_argument("--manifest", required=True)
    prepare_parser.set_defaults(func=prepare)

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--root", required=True)
    verify_parser.add_argument("--manifest", required=True)
    verify_parser.add_argument("--expected-manifest-sha256", required=True)
    verify_parser.set_defaults(func=verify)

    seal_parser = subparsers.add_parser("seal")
    seal_parser.add_argument("--root", required=True)
    seal_parser.add_argument("--manifest", required=True)
    seal_parser.add_argument("--expected-manifest-sha256", required=True)
    seal_parser.add_argument("--output", required=True)
    seal_parser.set_defaults(func=seal)

    verify_archive_parser = subparsers.add_parser("verify-archive")
    verify_archive_parser.add_argument("--archive", required=True)
    verify_archive_parser.add_argument("--manifest", required=True)
    verify_archive_parser.add_argument("--expected-manifest-sha256", required=True)
    verify_archive_parser.add_argument("--expected-archive-sha256", required=True)
    verify_archive_parser.set_defaults(func=verify_archive)
    return result


def main() -> int:
    try:
        args = parser().parse_args()
        args.func(args)
        return 0
    except ReleaseGateError as error:
        print(f"ReadMate API release source gate failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
