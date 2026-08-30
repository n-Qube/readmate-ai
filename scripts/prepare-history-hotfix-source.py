#!/usr/bin/env python3
"""Prepare a provenance-bound source manifest for an isolated history hotfix."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from history_hotfix_source_integrity import (
    MANIFEST_NAME,
    GateError,
    assert_distinct_roots,
    build_manifest,
    canonical_manifest_bytes,
    changed_files,
    parse_changed_files_json,
    require_directory,
    require_regular_file,
    sha256_file,
    source_snapshot,
    source_tree_sha256,
    validate_gcs_object,
    validate_generation,
    validate_sha256,
    write_manifest_exclusive,
)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--baseline-archive", required=True)
    result.add_argument("--baseline-dir", required=True)
    result.add_argument("--release-dir", required=True)
    result.add_argument("--baseline-gcs-object", required=True)
    result.add_argument("--baseline-gcs-generation", required=True)
    result.add_argument("--expected-gcs-object", required=True)
    result.add_argument("--expected-gcs-generation", required=True)
    result.add_argument("--expected-baseline-archive-sha256", required=True)
    result.add_argument("--expected-changed-files-json", required=True)
    result.add_argument("--expected-source-tree-sha256", required=True)
    return result


def run(args: argparse.Namespace) -> None:
    baseline = require_directory(args.baseline_dir, "baseline directory")
    release = require_directory(args.release_dir, "release directory")
    assert_distinct_roots(baseline, release)
    archive = require_regular_file(args.baseline_archive, "baseline archive")
    if archive == Path(release, MANIFEST_NAME) or release in archive.parents or baseline in archive.parents:
        raise GateError("baseline archive must be outside the baseline and release directories")

    actual_object = validate_gcs_object(args.baseline_gcs_object, "baseline GCS object")
    actual_generation = validate_generation(args.baseline_gcs_generation, "baseline GCS generation")
    expected_object = validate_gcs_object(args.expected_gcs_object, "expected GCS object")
    expected_generation = validate_generation(args.expected_gcs_generation, "expected GCS generation")
    expected_archive_hash = validate_sha256(
        args.expected_baseline_archive_sha256, "expected baseline archive SHA-256"
    )
    expected_tree_hash = validate_sha256(args.expected_source_tree_sha256, "expected source tree SHA-256")
    expected_changes = parse_changed_files_json(
        args.expected_changed_files_json, "expected changed files"
    )
    if actual_object != expected_object or actual_generation != expected_generation:
        raise GateError("recovered GCS baseline identity does not match the externally expected identity")
    actual_archive_hash = sha256_file(archive, "baseline archive")
    if actual_archive_hash != expected_archive_hash:
        raise GateError("baseline archive SHA-256 does not match the externally expected digest")

    manifest_path = release / MANIFEST_NAME
    if manifest_path.exists() or manifest_path.is_symlink():
        raise GateError(f"{MANIFEST_NAME} already exists; preparation refuses to overwrite it")
    baseline_snapshot = source_snapshot(baseline, exclude_manifest=False)
    release_snapshot = source_snapshot(release, exclude_manifest=False)
    observed_changes = changed_files(baseline_snapshot, release_snapshot)
    if observed_changes != expected_changes:
        raise GateError(
            "release changes do not exactly match the external allowlist; "
            f"observed={json.dumps(observed_changes, separators=(',', ':'))}"
        )
    actual_tree_hash = source_tree_sha256(release_snapshot)
    if actual_tree_hash != expected_tree_hash:
        raise GateError("release source tree SHA-256 does not match the externally expected digest")

    manifest = build_manifest(
        actual_object,
        actual_generation,
        actual_archive_hash,
        observed_changes,
        actual_tree_hash,
    )
    payload = canonical_manifest_bytes(manifest)
    write_manifest_exclusive(manifest_path, payload)
    manifest_hash = sha256_file(manifest_path, "source-isolation manifest")
    print(f"manifest_path={manifest_path}")
    print(f"manifest_sha256={manifest_hash}")
    print(f"source_tree_sha256={actual_tree_hash}")
    print(f"changed_files_json={json.dumps(observed_changes, separators=(',', ':'))}")
    print("source_isolation_gate=prepared")


if __name__ == "__main__":
    try:
        run(parser().parse_args())
    except GateError as error:
        print(f"source isolation preparation failed: {error}", file=sys.stderr)
        raise SystemExit(1)

