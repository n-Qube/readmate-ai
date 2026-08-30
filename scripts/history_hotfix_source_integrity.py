#!/usr/bin/env python3
"""Fail-closed source integrity primitives for the ReadMate history hotfix."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import struct
from pathlib import Path
from typing import Any


MANIFEST_NAME = "release-manifest.json"
MANIFEST_KIND = "readmate-history-hotfix-source-isolation"
SCHEMA_VERSION = 1
TREE_HASH_ALGORITHM = "sha256-file-tree-v1"
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_GENERATION_RE = re.compile(r"^[1-9][0-9]{9,29}$")
_GCS_RE = re.compile(r"^gs://([A-Za-z0-9._-]{3,222})/(.+)$")
_PLACEHOLDER_TOKENS = ("placeholder", "example", "changeme", "replace-me", "todo", "tbd")


class GateError(RuntimeError):
    """Raised when a source-isolation invariant is not proven."""


def fail(message: str) -> None:
    raise GateError(message)


def _is_placeholder(value: str) -> bool:
    lowered = value.lower()
    return (
        not value.strip()
        or value != value.strip()
        or any(token in lowered for token in _PLACEHOLDER_TOKENS)
        or "<" in value
        or ">" in value
    )


def validate_sha256(value: str, label: str) -> str:
    if not isinstance(value, str) or not _SHA256_RE.fullmatch(value):
        fail(f"{label} must be exactly 64 lowercase hexadecimal characters")
    if len(set(value)) == 1:
        fail(f"{label} is a placeholder-like digest")
    return value


def validate_generation(value: str, label: str) -> str:
    if not isinstance(value, str) or not _GENERATION_RE.fullmatch(value):
        fail(f"{label} must be a 10-30 digit positive GCS generation string")
    return value


def validate_gcs_object(value: str, label: str) -> str:
    if not isinstance(value, str) or _is_placeholder(value):
        fail(f"{label} is empty or placeholder-like")
    match = _GCS_RE.fullmatch(value)
    if not match:
        fail(f"{label} must be an unversioned gs://bucket/object URI")
    bucket, object_name = match.groups()
    if ".." in bucket or "#" in object_name or "?" in object_name or "\\" in object_name:
        fail(f"{label} contains an ambiguous or unsafe component")
    validate_relative_path(object_name, label)
    return value


def validate_relative_path(value: str, label: str = "path") -> str:
    if not isinstance(value, str) or not value or value.startswith("/"):
        fail(f"{label} must be a non-empty relative POSIX path")
    if "\\" in value or "\x00" in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        fail(f"{label} contains unsafe characters")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        fail(f"{label} contains an unsafe path segment")
    if parts[0] == ".git":
        fail(f"{label} must not address Git metadata")
    if value == MANIFEST_NAME:
        fail(f"{label} must not be the source-isolation manifest")
    return value


def parse_changed_files_json(value: str, label: str) -> list[str]:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label} is required")
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        fail(f"{label} must be a JSON array: {error.msg}")
    if not isinstance(parsed, list) or not parsed:
        fail(f"{label} must be a non-empty JSON array")
    if any(not isinstance(item, str) for item in parsed):
        fail(f"{label} must contain only strings")
    checked = [validate_relative_path(item, f"{label} entry") for item in parsed]
    if checked != sorted(checked) or len(checked) != len(set(checked)):
        fail(f"{label} must be sorted bytewise and contain no duplicates")
    return checked


def require_directory(raw_path: str, label: str) -> Path:
    path = Path(raw_path)
    try:
        metadata = path.lstat()
    except OSError as error:
        fail(f"{label} cannot be inspected: {error}")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        fail(f"{label} must be a real directory, not a link or special file")
    return path.resolve(strict=True)


def require_regular_file(raw_path: str, label: str) -> Path:
    path = Path(raw_path)
    try:
        metadata = path.lstat()
    except OSError as error:
        fail(f"{label} cannot be inspected: {error}")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        fail(f"{label} must be a real regular file, not a link or special file")
    return path.resolve(strict=True)


def _stable_file_record(path: Path, label: str) -> tuple[int, int, str]:
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        fail("this platform cannot guarantee no-follow file hashing")
    try:
        descriptor = os.open(path, os.O_RDONLY | nofollow)
    except OSError as error:
        fail(f"{label} cannot be opened safely: {error}")
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            fail(f"{label} changed into a non-regular file during inspection")
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    stable_fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns")
    if any(getattr(before, field) != getattr(after, field) for field in stable_fields) or total != before.st_size:
        fail(f"{label} changed while it was being hashed")
    return stat.S_IMODE(before.st_mode), before.st_size, digest.hexdigest()


def sha256_file(path: Path, label: str) -> str:
    return _stable_file_record(path, label)[2]


def source_snapshot(root: Path, *, exclude_manifest: bool) -> dict[str, tuple[int, int, str]]:
    records: dict[str, tuple[int, int, str]] = {}

    def walk(directory: Path, prefix: str) -> None:
        try:
            entries = sorted(os.scandir(directory), key=lambda item: os.fsencode(item.name))
        except OSError as error:
            fail(f"source directory cannot be read safely: {error}")
        for entry in entries:
            relative = f"{prefix}/{entry.name}" if prefix else entry.name
            if relative == ".git":
                metadata = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(metadata.st_mode) or not (
                    stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)
                ):
                    fail("root Git metadata is a link or special file")
                continue
            if relative == MANIFEST_NAME and exclude_manifest:
                metadata = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                    fail("source-isolation manifest is a link or special file")
                continue
            validate_relative_path(relative, "source path")
            metadata = entry.stat(follow_symlinks=False)
            if stat.S_ISLNK(metadata.st_mode):
                fail(f"source contains a forbidden symbolic link: {relative}")
            if stat.S_ISDIR(metadata.st_mode):
                walk(Path(entry.path), relative)
            elif stat.S_ISREG(metadata.st_mode):
                records[relative] = _stable_file_record(Path(entry.path), f"source file {relative}")
            else:
                fail(f"source contains a forbidden special file: {relative}")

    walk(root, "")
    return records


def source_tree_sha256(records: dict[str, tuple[int, int, str]]) -> str:
    digest = hashlib.sha256()
    digest.update((TREE_HASH_ALGORITHM + "\0").encode("ascii"))
    for relative in sorted(records, key=os.fsencode):
        mode, size, file_digest = records[relative]
        encoded = relative.encode("utf-8")
        digest.update(b"F\0")
        digest.update(struct.pack(">I", len(encoded)))
        digest.update(encoded)
        digest.update(struct.pack(">I", mode))
        digest.update(struct.pack(">Q", size))
        digest.update(bytes.fromhex(file_digest))
    return digest.hexdigest()


def changed_files(
    baseline: dict[str, tuple[int, int, str]],
    release: dict[str, tuple[int, int, str]],
) -> list[str]:
    return sorted(
        (path for path in baseline.keys() | release.keys() if baseline.get(path) != release.get(path)),
        key=os.fsencode,
    )


def canonical_manifest_bytes(manifest: dict[str, Any]) -> bytes:
    return (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def build_manifest(
    gcs_object: str,
    generation: str,
    archive_sha256: str,
    allowed_changed_files: list[str],
    tree_sha256: str,
) -> dict[str, Any]:
    return {
        "baseline": {
            "archiveSha256": archive_sha256,
            "gcsGeneration": generation,
            "gcsObject": gcs_object,
        },
        "kind": MANIFEST_KIND,
        "release": {
            "allowedChangedFiles": allowed_changed_files,
            "sourceTreeSha256": tree_sha256,
            "treeHashAlgorithm": TREE_HASH_ALGORITHM,
        },
        "schemaVersion": SCHEMA_VERSION,
    }


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"manifest contains duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_and_validate_manifest(raw: bytes) -> dict[str, Any]:
    try:
        decoded = raw.decode("utf-8")
        manifest = json.loads(decoded, object_pairs_hook=_strict_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"manifest is not strict UTF-8 JSON: {error}")
    if not isinstance(manifest, dict):
        fail("manifest root must be an object")
    if set(manifest) != {"baseline", "kind", "release", "schemaVersion"}:
        fail("manifest root schema has missing or unexpected fields")
    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != SCHEMA_VERSION:
        fail("manifest schemaVersion is unsupported")
    if manifest["kind"] != MANIFEST_KIND:
        fail("manifest kind is invalid")
    baseline = manifest["baseline"]
    release = manifest["release"]
    if not isinstance(baseline, dict) or set(baseline) != {"archiveSha256", "gcsGeneration", "gcsObject"}:
        fail("manifest baseline schema has missing or unexpected fields")
    if not isinstance(release, dict) or set(release) != {
        "allowedChangedFiles", "sourceTreeSha256", "treeHashAlgorithm"
    }:
        fail("manifest release schema has missing or unexpected fields")
    validate_gcs_object(baseline["gcsObject"], "manifest baseline gcsObject")
    validate_generation(baseline["gcsGeneration"], "manifest baseline gcsGeneration")
    validate_sha256(baseline["archiveSha256"], "manifest baseline archiveSha256")
    validate_sha256(release["sourceTreeSha256"], "manifest release sourceTreeSha256")
    if release["treeHashAlgorithm"] != TREE_HASH_ALGORITHM:
        fail("manifest treeHashAlgorithm is invalid")
    changed_json = json.dumps(release["allowedChangedFiles"], separators=(",", ":"))
    release["allowedChangedFiles"] = parse_changed_files_json(changed_json, "manifest allowedChangedFiles")
    if raw != canonical_manifest_bytes(manifest):
        fail("manifest must use the canonical JSON encoding produced by the preparation script")
    return manifest


def assert_distinct_roots(baseline: Path, release: Path) -> None:
    if baseline == release or baseline in release.parents or release in baseline.parents:
        fail("baseline and release directories must be distinct and non-nested")


def write_manifest_exclusive(path: Path, payload: bytes) -> None:
    if path.parent != path.parent.resolve(strict=True):
        fail("manifest parent path resolves through an unexpected link")
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except OSError as error:
        fail(f"manifest must not already exist and could not be created: {error}")
    try:
        written = os.write(descriptor, payload)
        if written != len(payload):
            fail("manifest write was incomplete")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

