#!/usr/bin/env python3
"""Verify a submitted history-hotfix source tree against external trust values."""

from __future__ import annotations

import argparse
import sys

from history_hotfix_source_integrity import (
    MANIFEST_NAME,
    GateError,
    canonical_manifest_bytes,
    parse_and_validate_manifest,
    parse_changed_files_json,
    require_directory,
    require_regular_file,
    sha256_file,
    source_snapshot,
    source_tree_sha256,
    validate_gcs_object,
    validate_generation,
    validate_sha256,
)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--source-dir", required=True)
    result.add_argument("--expected-manifest-sha256", required=True)
    result.add_argument("--expected-gcs-object", required=True)
    result.add_argument("--expected-gcs-generation", required=True)
    result.add_argument("--expected-baseline-archive-sha256", required=True)
    result.add_argument("--expected-changed-files-json", required=True)
    result.add_argument("--expected-source-tree-sha256", required=True)
    return result


def run(args: argparse.Namespace) -> None:
    source = require_directory(args.source_dir, "submitted source directory")
    manifest_path = require_regular_file(str(source / MANIFEST_NAME), "source-isolation manifest")
    expected_manifest_hash = validate_sha256(args.expected_manifest_sha256, "expected manifest SHA-256")
    expected_object = validate_gcs_object(args.expected_gcs_object, "expected GCS object")
    expected_generation = validate_generation(args.expected_gcs_generation, "expected GCS generation")
    expected_archive_hash = validate_sha256(
        args.expected_baseline_archive_sha256, "expected baseline archive SHA-256"
    )
    expected_tree_hash = validate_sha256(args.expected_source_tree_sha256, "expected source tree SHA-256")
    expected_changes = parse_changed_files_json(
        args.expected_changed_files_json, "expected changed files"
    )

    actual_manifest_hash = sha256_file(manifest_path, "source-isolation manifest")
    if actual_manifest_hash != expected_manifest_hash:
        raise GateError("manifest SHA-256 does not match the externally expected digest")
    raw = manifest_path.read_bytes()
    manifest = parse_and_validate_manifest(raw)
    if raw != canonical_manifest_bytes(manifest):
        raise GateError("manifest encoding changed during validation")
    baseline = manifest["baseline"]
    release = manifest["release"]
    if baseline["gcsObject"] != expected_object:
        raise GateError("manifest GCS object does not match the externally expected object")
    if baseline["gcsGeneration"] != expected_generation:
        raise GateError("manifest GCS generation does not match the externally expected generation")
    if baseline["archiveSha256"] != expected_archive_hash:
        raise GateError("manifest archive SHA-256 does not match the externally expected digest")
    if release["allowedChangedFiles"] != expected_changes:
        raise GateError("manifest changed-file allowlist does not match the external allowlist")
    if release["sourceTreeSha256"] != expected_tree_hash:
        raise GateError("manifest source tree SHA-256 does not match the externally expected digest")

    actual_tree_hash = source_tree_sha256(source_snapshot(source, exclude_manifest=True))
    if actual_tree_hash != expected_tree_hash:
        raise GateError("submitted source tree SHA-256 does not match the externally expected digest")
    print(f"manifest_sha256={actual_manifest_hash}")
    print(f"source_tree_sha256={actual_tree_hash}")
    print("source_isolation_gate=verified")


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except GateError as error:
        print(f"source isolation verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)

